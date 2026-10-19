# «Волна» — запуск. Скачивает всё необходимое сам и открывает приложение.
# Самый простой способ: двойной клик по start.cmd, ярлык «Волна» на рабочем столе
# или кнопка автозапуска (install-autostart.cmd).
#
# Ключи:
#   -Shortcut     запуск с ярлыка: окно консоли скрыто, ошибки показываются в окошке
#   -NoBrowser    не открывать окно приложения (режим сервера, автозапуск)
#   -Room main    комната, в которую окно войдёт автоматически (по умолчанию main)
#   -ParentPid N  номер процесса, который нас запустил (настольное приложение):
#                 если он закроется, сервер остановится сам — «висящих» процессов не будет
#
# При первом запуске (нужен интернет только в этот раз):
#   1) если Node.js не установлен — скачивается портативная версия в папку runtime
#   2) если нет голосового сервера — скачивается livekit-server.exe
#   3) если нет библиотек — выполняется установка зависимостей
#   4) создаётся сертификат и конфигурация, запускаются серверы, открывается окно приложения

param([switch]$NoBrowser, [switch]$Shortcut, [string]$Room = 'main', [int]$ParentPid = 0)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $root

try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }

function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Fail([string]$text) {
  Write-Host ''
  Say $text 'Red'
  Write-Host ''
  if ($Shortcut) {
    # запуск с ярлыка: окно консоли скрыто, поэтому ошибку показываем окошком (с ограничением по времени)
    try { (New-Object -ComObject WScript.Shell).Popup($text, 180, 'Волна — запуск', 16) | Out-Null } catch { }
  } elseif (-not $NoBrowser) {
    Read-Host 'Enter — закрыть'
  }
  exit 1
}

# Код приглашения для ссылки: комната и ключ доступа в одном коротком куске строки.
function New-InviteCode([string]$RoomName, [string]$Key) {
  $json = @{ r = $RoomName; k = $Key } | ConvertTo-Json -Compress
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
  return $b64.Replace('+', '-').Replace('/', '_').TrimEnd('=')
}

# public/addresses.json — адреса, по которым приложение доступно участникам.
# По ним строится ссылка-приглашение, чтобы она не вела на localhost.
function Write-AddressesFile($Cfg) {
  $list = @()
  $domain = ''
  if ($Cfg.deploy -and $Cfg.deploy.domain) { $domain = $Cfg.deploy.domain }
  if ($domain) {
    $suffix = if ([int]$Cfg.port -eq 443) { '' } else { ':' + $Cfg.port }
    $list += ('https://' + $domain + $suffix)
  }
  foreach ($ip in @($Cfg.deploy.lanIps)) { if ($ip) { $list += ('https://' + $ip + ':' + $Cfg.port) } }
  $path = Join-Path $root 'public\addresses.json'
  $json = (@{ addresses = $list } | ConvertTo-Json)
  try {
    [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
  } catch { }
}

# Проверка «сервер отвечает»: у самоподписанного сертификата встроенный
# Invoke-RestMethod на части машин срывает TLS-рукопожатие, поэтому сначала curl.exe.
function Test-Health([string]$Url) {
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    try {
      $out = & $curl.Source '-sk' '--max-time' '4' ($Url + '/api/health') 2>$null
      if ($LASTEXITCODE -eq 0 -and $out -and (($out -join '') -match '"ok"')) { return $true }
    } catch { }
  }
  try {
    $r = Invoke-RestMethod ($Url + '/api/health') -TimeoutSec 4
    if ($r -and $r.ok) { return $true }
  } catch { }
  return $false
}

# ── загрузка файлов ───────────────────────────────────────────
# На части компьютеров встроенный PowerShell ломается на HTTPS
# («Базовое соединение закрыто»). Поэтому пробуем по очереди три способа.
$script:lastErrors = @()

function Get-Text([string]$Url) {
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    try {
      $out = & $curl.Source '--fail' '--location' '--silent' '--max-time' '90' $Url 2>&1
      if ($LASTEXITCODE -eq 0 -and $out) { return ($out -join "`n") }
      $script:lastErrors += ('curl.exe: код ' + $LASTEXITCODE)
    } catch { $script:lastErrors += ('curl.exe: ' + $_.Exception.Message) }
  }
  try {
    return (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 90).Content
  } catch { $script:lastErrors += ('PowerShell: ' + $_.Exception.Message) }
  return $null
}

function Get-File([string]$Url, [string]$OutFile) {
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    try {
      & $curl.Source '--fail' '--location' '--silent' '--show-error' '--max-time' '900' '--output' $OutFile $Url 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0 -and (Test-Path $OutFile) -and (Get-Item $OutFile).Length -gt 0) { return 'curl.exe' }
      if (Test-Path $OutFile) { Remove-Item $OutFile -Force -ErrorAction SilentlyContinue }
      $script:lastErrors += ('curl.exe: код ' + $LASTEXITCODE)
    } catch { $script:lastErrors += ('curl.exe: ' + $_.Exception.Message) }
  }
  try {
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -TimeoutSec 900
    if ((Test-Path $OutFile) -and (Get-Item $OutFile).Length -gt 0) { return 'PowerShell' }
  } catch { $script:lastErrors += ('PowerShell: ' + $_.Exception.Message) }
  try {
    Start-BitsTransfer -Source $Url -Destination $OutFile -TransferType Download -ErrorAction Stop
    if ((Test-Path $OutFile) -and (Get-Item $OutFile).Length -gt 0) { return 'BITS' }
  } catch { $script:lastErrors += ('BITS: ' + $_.Exception.Message) }
  return $null
}

function Expand-ZipFile([string]$ZipPath, [string]$Destination) {
  if (Get-Command Expand-Archive -ErrorAction SilentlyContinue) {
    Expand-Archive -Path $ZipPath -DestinationPath $Destination -Force
    return
  }
  # старые версии PowerShell: распаковываем средствами .NET
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $Destination)
}

function Show-NetDiagnostics {
  Say ''
  Say '  Диагностика загрузки:' 'Yellow'
  Say ('    Windows: ' + [System.Environment]::OSVersion.VersionString) 'DarkGray'
  Say ('    PowerShell: ' + $PSVersionTable.PSVersion) 'DarkGray'
  $c = Get-Command curl.exe -ErrorAction SilentlyContinue
  Say ('    curl.exe: ' + $(if ($c) { 'есть' } else { 'нет' })) 'DarkGray'
  Say ('    TLS: ' + [Net.ServicePointManager]::SecurityProtocol) 'DarkGray'
  foreach ($e in $script:lastErrors) { Say ('    ' + $e) 'DarkGray' }
  Say ''
}

Say ''
Say '  Волна — голосовая связь' 'Cyan'
Say '  ----------------------------------------------' 'DarkGray'

# ── 0. Может, уже запущено? ───────────────────────────────────
$cfgPath = Join-Path $root 'config.json'
if ((Test-Path $cfgPath) -and (Test-Path (Join-Path $root 'certs\server.crt'))) {
  try {
    $liveCfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $probe = $liveCfg.port
    if (-not (Test-Health ('https://localhost:' + $probe))) { throw 'сервер не отвечает' }
    Say ''
    Say '  Приложение уже запущено — просто открываю окно.' 'Yellow'
    $already = 'https://localhost:' + $probe + '/#i=' + (New-InviteCode $Room $liveCfg.roomPassword)
    $edge = @()
    if ($env:ProgramFiles) { $edge += (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe') }
    if (${env:ProgramFiles(x86)}) { $edge += (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe') }
    if ($env:ProgramFiles) { $edge += (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe') }
    $browser = $edge | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if (-not $NoBrowser) {
      Say ('  Адрес окна: ' + $already) 'DarkGray'
      if ($browser) { Start-Process -FilePath $browser -ArgumentList @('--app=' + $already) } else { Start-Process $already }
    }
    exit 0
  } catch { }
}

$runtimeDir = Join-Path $root 'runtime'
$nodeDir = Join-Path $runtimeDir 'node'
$nodeExe = $null

# ── 1. Node.js ────────────────────────────────────────────────
Say ''
Say '  Проверяю Node.js…' 'Cyan'

$onPath = Get-Command node -ErrorAction SilentlyContinue
if ($onPath) {
  try {
    $v = & $onPath.Source -v 2>$null
    if ($v -match '^v(\d+)\.' -and [int]$Matches[1] -ge 18) { $nodeExe = $onPath.Source }
  } catch { }
}

if (-not $nodeExe -and (Test-Path (Join-Path $nodeDir 'node.exe'))) {
  $nodeExe = Join-Path $nodeDir 'node.exe'
}

if (-not $nodeExe) {
  Say '  Node.js не найден — скачиваю портативную версию (~30 МБ, права администратора не нужны)…' 'Cyan'
  try {
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    $zipPath = Join-Path $runtimeDir 'node.zip'

    if ((Test-Path $zipPath) -and (Get-Item $zipPath).Length -gt 100000) {
      Say '  использую готовый файл runtime\node.zip' 'DarkGray'
    } else {
      $arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
      $indexText = Get-Text 'https://nodejs.org/dist/index.json'
      if (-not $indexText) { throw 'не удалось получить список версий' }
      $entry = ($indexText | ConvertFrom-Json) | Where-Object { $_.lts } | Select-Object -First 1
      if (-not $entry) { throw 'не удалось определить актуальную версию' }
      $url = 'https://nodejs.org/dist/' + $entry.version + '/node-' + $entry.version + '-win-' + $arch + '.zip'
      Say ('  Версия: ' + $entry.version) 'DarkGray'
      $via = Get-File -Url $url -OutFile $zipPath
      if (-not $via) { throw 'ни один из способов загрузки не сработал (подробности ниже)' }
      Say ('  скачано: ' + $via) 'DarkGray'
    }

    $tmp = Join-Path $runtimeDir 'tmp'
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-ZipFile -ZipPath $zipPath -Destination $tmp
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    if (-not $inner) { throw 'неожиданная структура архива' }
    if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
    Move-Item $inner.FullName $nodeDir
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

    $nodeExe = Join-Path $nodeDir 'node.exe'
    Unblock-File -Path $nodeExe -ErrorAction SilentlyContinue
    Say '  Node.js готов' 'Green'
  } catch {
    Show-NetDiagnostics
    Fail ('Не удалось подготовить Node.js: ' + $_.Exception.Message + "`n`n" +
      'Что можно сделать (любой из вариантов):' + "`n" +
      '  1) установить Node.js LTS вручную: https://nodejs.org — обычный установщик Windows,' + "`n" +
      '     затем запустить start.cmd снова;' + "`n" +
      '  2) скачать вручную архив node-v…-win-x64.zip и положить его в папку runtime' + "`n" +
      '     под именем node.zip, затем запустить start.cmd снова;' + "`n" +
      '  3) проверить антивирус и прокси: они часто рвут HTTPS-загрузку в Windows PowerShell.' + "`n`n" +
      'Подробнее — README.md, раздел 8.')
  }
}

if (-not (Test-Path $nodeExe)) { Fail ('Не найден исполняемый файл Node.js: ' + $nodeExe) }
$env:Path = (Split-Path $nodeExe -Parent) + ';' + $env:Path
Say ('  Использую Node.js ' + (& $nodeExe -v)) 'DarkGray'

# ── 2. Голосовой сервер LiveKit ───────────────────────────────
$lkDir = Join-Path $root 'livekit'
$lkBin = Join-Path $lkDir 'livekit-server.exe'
$lkCfg = Join-Path $lkDir 'livekit.yaml'

if (-not (Test-Path $lkBin)) {
  Say ''
  Say '  Голосовой сервер не найден — скачиваю (~30 МБ)…' 'Cyan'
  try {
    New-Item -ItemType Directory -Force -Path $lkDir | Out-Null
    $zipPath = Join-Path $lkDir 'livekit.zip'

    if ((Test-Path $zipPath) -and (Get-Item $zipPath).Length -gt 100000) {
      Say '  использую готовый файл livekit\livekit.zip' 'DarkGray'
    } else {
      $apiText = Get-Text 'https://api.github.com/repos/livekit/livekit/releases/latest'
      if (-not $apiText) {
        Say '  сеть ответила не сразу — пробую ещё раз…' 'DarkGray'
        Start-Sleep -Seconds 3
        $apiText = Get-Text 'https://api.github.com/repos/livekit/livekit/releases/latest'
      }
      if (-not $apiText) { throw 'не удалось получить список релизов' }
      $rel = $apiText | ConvertFrom-Json
      $asset = $rel.assets | Where-Object { $_.name -like '*windows_amd64.zip' } | Select-Object -First 1
      if (-not $asset) { throw 'не нашёл сборку для Windows' }
      Say ('  Версия: ' + $rel.tag_name) 'DarkGray'
      $via = Get-File -Url $asset.browser_download_url -OutFile $zipPath
      if (-not $via) { throw 'ни один из способов загрузки не сработал' }
      Say ('  скачано: ' + $via) 'DarkGray'
    }

    Expand-ZipFile -ZipPath $zipPath -Destination $lkDir
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    Unblock-File -Path $lkBin -ErrorAction SilentlyContinue
    Say '  Голосовой сервер готов' 'Green'
  } catch {
    Show-NetDiagnostics
    Fail ('Не удалось скачать голосовой сервер: ' + $_.Exception.Message + "`n`n" +
      'Скачайте вручную: https://github.com/livekit/livekit/releases (файл …windows_amd64.zip)' + "`n" +
      'и положите архив в папку livekit под именем livekit.zip, затем запустите start.cmd снова.' + "`n" +
      'Либо просто распакуйте livekit-server.exe из архива в папку livekit вручную.')
  }
} else {
  try { Unblock-File -Path $lkBin -ErrorAction SilentlyContinue } catch { }
}

# ── 3. Библиотеки приложения ──────────────────────────────────
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Say ''
  Say '  Устанавливаю библиотеки (один раз, ~15 МБ)…' 'Cyan'
  $npmCli = Join-Path (Split-Path $nodeExe -Parent) 'node_modules\npm\bin\npm-cli.js'
  if (Test-Path $npmCli) {
    & $nodeExe $npmCli install --no-audit --no-fund --loglevel=error
  } else {
    npm install --no-audit --no-fund --loglevel=error
  }
  if ($LASTEXITCODE -ne 0) { Fail 'Не удалось установить библиотеки. Проверьте интернет и запустите снова.' }
  Say '  Библиотеки готовы' 'Green'
}

# ── 4. Конфигурация и сертификат ──────────────────────────────
& $nodeExe (Join-Path $root 'server\setup.js') | Out-Null
$cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$port = $cfg.port
Write-AddressesFile $cfg
$inviteHash = '#i=' + (New-InviteCode $Room $cfg.roomPassword)

# ── 5. Остановка прошлых запусков ─────────────────────────────
$runDir = Join-Path $root 'run'
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
foreach ($name in @('server.pid', 'livekit.pid')) {
  $pf = Join-Path $runDir $name
  if (Test-Path $pf) {
    $oldId = (Get-Content $pf -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($oldId) { try { Stop-Process -Id ([int]$oldId) -Force -ErrorAction SilentlyContinue } catch { } }
    Remove-Item $pf -Force -ErrorAction SilentlyContinue
  }
}

# ── 6. Запуск серверов ────────────────────────────────────────
Say ''
Say '  Запускаю голосовой сервер…' 'Cyan'
$lk = Start-Process -FilePath $lkBin -ArgumentList @('--config', $lkCfg) `
  -WorkingDirectory $lkDir -PassThru -NoNewWindow `
  -RedirectStandardOutput (Join-Path $runDir 'livekit.out.log') `
  -RedirectStandardError (Join-Path $runDir 'livekit.err.log')
Set-Content -Path (Join-Path $runDir 'livekit.pid') -Value $lk.Id
Start-Sleep -Milliseconds 1500

Say '  Запускаю веб-сервер…' 'Cyan'
$srv = Start-Process -FilePath $nodeExe -ArgumentList @('server\server.js') `
  -WorkingDirectory $root -PassThru -NoNewWindow
Set-Content -Path (Join-Path $runDir 'server.pid') -Value $srv.Id

$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  if ($srv.HasExited) { break }
  if (Test-Health ('https://localhost:' + $port)) { $ready = $true; break }
  Start-Sleep -Milliseconds 350
}

$url = 'https://localhost:' + $port
Say ''
if ($ready) {
  Say ('  Приложение запущено:   ' + $url) 'Green'
  foreach ($ip in @($cfg.deploy.lanIps)) {
    Say ('  Для других устройств:  https://' + $ip + ':' + $port) 'Green'
  }
  Say ('  Пароль комнаты:        ' + $cfg.roomPassword) 'Green'
  Say ''
  Say '  Отправьте эти адрес и пароль остальным — им ничего устанавливать не нужно.' 'DarkGray'
  Say '  Кнопка «Пригласить» в окне приложения скопирует готовую ссылку: подключение произойдёт само.' 'DarkGray'
} else {
  Say '  Сервер не ответил за отведённое время.' 'Yellow'
  Say '  Смотрите журналы в папке run.' 'Yellow'
}
Say ''

# ── 7. Окно приложения ────────────────────────────────────────
function Open-AppWindow([string]$target) {
  $cands = @()
  if ($env:ProgramFiles) {
    $cands += (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    $cands += (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe')
  }
  if (${env:ProgramFiles(x86)}) {
    $cands += (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
    $cands += (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
  }
  if ($env:LOCALAPPDATA) {
    $cands += (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  }
  foreach ($exe in $cands) {
    if ($exe -and (Test-Path $exe)) {
      Say ('  Открываю окно приложения (' + (Split-Path $exe -Leaf) + '): ' + $target) 'Cyan'
      Start-Process -FilePath $exe -ArgumentList @('--app=' + $target)
      return
    }
  }
  Say '  Edge и Chrome не найдены — открываю браузер по умолчанию.' 'DarkGray'
  Start-Process $target
}
if ($NoBrowser) {
  Say '  Работаю в фоновом режиме: окно приложения не открываю.' 'DarkGray'
} else {
  Open-AppWindow ($url + '/' + $inviteHash)
}

Say ''
Say '  Приложение работает. Это окно не закрывайте.' 'DarkGray'
Say '  Остановить: Ctrl+C, закрыть окно или запустить stop.cmd.' 'DarkGray'
Say ''

# Сторож: если нас зовёт не окно приложения (число не передали), определяем родителя сами.
# Так работает и без правок в настольном приложении.
if ($ParentPid -le 0) {
  try {
    $me = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $PID) -ErrorAction Stop
    if ($me -and $me.ParentProcessId -gt 0) {
      $parent = Get-Process -Id $me.ParentProcessId -ErrorAction SilentlyContinue
      if ($parent -and @('electron', 'volna', 'Volna') -contains $parent.ProcessName) {
        $ParentPid = [int]$parent.Id
        Say ('  Слежу за окном приложения (pid ' + $ParentPid + ').') 'DarkGray'
      }
    }
  } catch { }
}

# Отдельный сторож: сам супервизор может погибнуть вместе с окном приложения
# (Electron закрывает дочерние процессы), а сторож запущен отдельно и останется,
# чтобы остановить сервер и не оставить «висящих» процессов.
if ($ParentPid -gt 0) {
  try {
    $watchScript = Join-Path $root 'watch-parent.ps1'
    if (Test-Path $watchScript) {
      Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $watchScript,
        '-ParentPid', [string]$ParentPid, '-Root', $root
      ) | Out-Null
    }
  } catch { }
}

try {
  # Сторож: настольное приложение передаёт свой номер процесса. Если окно закрылось
  # (в том числе аварийно, через диспетчер задач), сервер не должен остаться в фоне —
  # иначе понадобился бы отдельный ярлык «остановить».
  while (-not $srv.HasExited) {
    if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) {
      Say '  Окно приложения закрылось — останавливаю сервер.' 'DarkGray'
      break
    }
    Start-Sleep -Milliseconds 1200
  }
} catch {
  # прервано пользователем
} finally {
  Say 'Останавливаю…' 'DarkGray'
  foreach ($p in @($srv, $lk)) {
    try { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force } } catch { }
  }
  Remove-Item (Join-Path $runDir 'server.pid') -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $runDir 'livekit.pid') -Force -ErrorAction SilentlyContinue
}
