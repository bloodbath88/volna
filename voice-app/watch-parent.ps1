# «Волна» — сторож настольного приложения.
#
# Запускается из start.ps1, когда сервер поднимает настольное приложение.
# Смысл: даже если окно приложения закрыли аварийно (диспетчер задач, сбой),
# сервер не должен остаться висеть в фоне — иначе понадобился бы отдельный
# ярлык «остановить». Сторож проверяет родителя раз в 2 секунды и, если тот
# исчез, останавливает сервер тем же stop.ps1 (с проверкой, что процессы наши).
#
# Сторож завершается сам, когда останавливать уже нечего.

param([int]$ParentPid = 0, [string]$Root = '')

$ErrorActionPreference = 'SilentlyContinue'
if (-not $Root) { $Root = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$stopScript = Join-Path $Root 'stop.ps1'
$rootLower = $Root.ToLowerInvariant()

function Get-OurProcesses {
  $list = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='livekit-server.exe'" -ErrorAction SilentlyContinue
  return @($list | Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($rootLower) })
}

while ($true) {
  Start-Sleep -Seconds 2

  # сервер уже остановлен — сторож больше не нужен
  if (-not (Get-OurProcesses)) { break }

  if ($ParentPid -le 0) { break }
  $parent = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
  if ($parent) { continue }

  # окно приложения исчезло — останавливаем сервер
  if (Test-Path $stopScript) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript -Quiet
  }
  break
}
