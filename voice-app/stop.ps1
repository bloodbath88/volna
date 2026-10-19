# «Волна» — остановить сервер приложения.
#
# Обычно этот файл не нужен: приложение останавливает сервер само — при выходе
# и даже если оно аварийно закрылось (сторож в start.ps1 видит, что окно исчезло).
# Скрипт нужен для двух случаев:
#   1) сервер запущен в фоне (start.cmd / автозапуск), а окна управления нет;
#   2) приложение закрыли через диспетчер задач, и процессы остались.
#
# Ключи:
#   -Quiet   без сообщений и без ожидания (для ярлыка)
#   -Pause   дождаться Enter перед закрытием окна
#   -DryRun  только показать, что будет остановлено
#
# Важно: скрипт не убивает процессы «по номеру» вслепую. Перед остановкой он
# проверяет, что это действительно наши node.exe / livekit-server.exe из папки
# приложения — иначе после перезагрузки номер мог достаться чужой программе.

param([switch]$Quiet, [switch]$Pause, [switch]$DryRun)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$runDir = Join-Path $root 'run'
$cfgPath = Join-Path $root 'config.json'

function Say([string]$text, [string]$color = 'Gray') {
  if (-not $Quiet) { Write-Host $text -ForegroundColor $color }
}

function Get-ProcInfo([int]$procId) {
  try {
    return Get-CimInstance Win32_Process -Filter ('ProcessId=' + $procId) -ErrorAction Stop
  } catch {
    return $null
  }
}

# Наш ли это процесс. Три признака, от самого надёжного к запасному:
#   1) исполняемый файл лежит в папке приложения (портативный Node.js, livekit);
#   2) путь к приложению есть в командной строке (абсолютные аргументы);
#   3) относительный запуск: node server\server.js из папки приложения, livekit --config …livekit.yaml
# Номер процесса сам по себе доказательством не считается — он мог достаться чужой программе.
function Test-Ours($proc) {
  if (-not $proc) { return $false }
  $name = ([string]$proc.Name).ToLowerInvariant()
  $cmd = ([string]$proc.CommandLine).ToLowerInvariant()
  $exe = ([string]$proc.ExecutablePath).ToLowerInvariant()
  $rootLower = $root.ToLowerInvariant()

  if ($exe -and $exe.StartsWith($rootLower)) { return $true }
  if ($cmd -and $cmd.Contains($rootLower)) { return $true }
  if ($name -eq 'node.exe' -and ($cmd.Contains('server\server.js') -or $cmd.Contains('server/server.js'))) { return $true }
  if ($name -eq 'livekit-server.exe' -and $cmd.Contains('livekit.yaml')) { return $true }
  return $false
}

function Stop-Tree([int]$procId) {
  # /T — вместе с дочерними процессами, /F — без уговоров
  & taskkill.exe /T /F /PID $procId 2>&1 | Out-Null
  return ($LASTEXITCODE -eq 0)
}

$port = 8443
if (Test-Path $cfgPath) {
  try {
    $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($cfg.port) { $port = [int]$cfg.port }
  } catch { }
}

# ── собираем кандидатов ──────────────────────────────────────
$candidates = @{}   # id -> откуда узнали

foreach ($name in @('server.pid', 'livekit.pid')) {
  $pf = Join-Path $runDir $name
  if (-not (Test-Path $pf)) { continue }
  $raw = (Get-Content $pf -ErrorAction SilentlyContinue | Select-Object -First 1)
  $procId = 0
  if ([int]::TryParse(([string]$raw).Trim(), [ref]$procId) -and $procId -gt 0) {
    $candidates[$procId] = 'файл ' + $name
  }
}

# Порты: веб-сервер и голосовое ядро (7881/tcp). Помогает, когда pid-файлов нет.
foreach ($p in @($port, 7881)) {
  try {
    foreach ($conn in @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)) {
      if ($conn.OwningProcess -and $conn.OwningProcess -gt 0) {
        $candidates[[int]$conn.OwningProcess] = 'порт ' + $p
      }
    }
  } catch { }
}

# Последний рубеж: процессы с путём приложения (после аварийного закрытия).
try {
  $all = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='livekit-server.exe'" -ErrorAction SilentlyContinue
  foreach ($proc in @($all)) {
    if ($proc -and (Test-Ours $proc)) { $candidates[[int]$proc.ProcessId] = 'по пути приложения' }
  }
} catch { }

# ── останавливаем ────────────────────────────────────────────
$stopped = 0
$skipped = 0
foreach ($procId in @($candidates.Keys)) {
  $proc = Get-ProcInfo $procId
  if (-not $proc) {
    Say ('  процесс ' + $procId + ' уже не работает (' + $candidates[$procId] + ')') 'DarkGray'
    continue
  }
  if (-not (Test-Ours $proc)) {
    $shown = ([string]$proc.Name) + ' — ' + $candidates[$procId]
    Say ('  пропускаю ' + $procId + ': это не «Волна» (' + $shown + ')') 'Yellow'
    $skipped++
    continue
  }
  if ($DryRun) {
    Say ('  остановил бы ' + $proc.Name + ' (pid ' + $procId + ', ' + $candidates[$procId] + ')') 'Cyan'
    $stopped++
    continue
  }
  if (Stop-Tree $procId) {
    Say ('  остановлен ' + $proc.Name + ' (pid ' + $procId + ')') 'Green'
    $stopped++
  } else {
    Say ('  не удалось остановить pid ' + $procId) 'Red'
  }
}

if (-not $DryRun) {
  foreach ($name in @('server.pid', 'livekit.pid')) {
    $pf = Join-Path $runDir $name
    if (Test-Path $pf) { Remove-Item $pf -Force -ErrorAction SilentlyContinue }
  }
}

Say ''
if ($DryRun) {
  Say ('  Проверка: нашлось процессов — ' + $stopped + '.') 'Cyan'
} elseif ($stopped -gt 0) {
  Say ('  Готово: остановлено процессов — ' + $stopped + '.') 'Green'
} elseif ($skipped -gt 0) {
  Say '  Ничего не остановлено: подходящих процессов «Волны» нет.' 'Yellow'
} else {
  Say '  «Волна» уже не запущена.' 'DarkGray'
}

if ($Pause -and -not $Quiet) { Read-Host 'Enter — закрыть' | Out-Null }
