# «Волна» — остановить приложение.
# Полезно, если окно запуска было закрыто крестиком, а процессы остались.

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$runDir = Join-Path $root 'run'

$found = $false
foreach ($name in @('server.pid', 'livekit.pid')) {
  $pf = Join-Path $runDir $name
  if (-not (Test-Path $pf)) { continue }
  $procId = (Get-Content $pf -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($procId) {
    try {
      Stop-Process -Id ([int]$procId) -Force -ErrorAction Stop
      Write-Host ('Остановлен процесс ' + $procId) -ForegroundColor Green
      $found = $true
    } catch {
      Write-Host ('Процесс ' + $procId + ' уже не работает') -ForegroundColor DarkGray
    }
  }
  Remove-Item $pf -Force -ErrorAction SilentlyContinue
}

if (-not $found) {
  Write-Host 'Активных процессов «Волны» не найдено.' -ForegroundColor DarkGray
}
Read-Host 'Enter — закрыть'
