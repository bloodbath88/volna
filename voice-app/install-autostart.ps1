# «Волна» — автозапуск при включении компьютера.
# Нужен, если приложение работает на сервере (VPS) или на постоянно включённом ПК.
#
# Установить:  install-autostart.cmd  → правый клик → «Запуск от имени администратора»
# Отменить:    powershell -NoProfile -ExecutionPolicy Bypass -File install-autostart.ps1 -Remove

param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$taskName = 'Волна — голосовая связь'

function Pause-IfNeeded {
  if (-not $env:VOLNA_NO_PAUSE) { Read-Host 'Enter — закрыть' }
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host ''
  Write-Host 'Нужны права администратора.' -ForegroundColor Red
  Write-Host 'Закройте окно и запустите install-autostart.cmd через «Запуск от имени администратора».' -ForegroundColor Yellow
  Write-Host ''
  Pause-IfNeeded
  exit 1
}

if ($Remove) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host 'Автозапуск отключён.' -ForegroundColor Green
  } else {
    Write-Host 'Задача автозапуска не найдена — возможно, он и не включался.' -ForegroundColor DarkGray
  }
  Write-Host ''
  Pause-IfNeeded
  exit 0
}

$script = Join-Path $root 'start.ps1'
if (-not (Test-Path $script)) {
  Write-Host 'Не найден start.ps1 рядом с этим файлом.' -ForegroundColor Red
  Pause-IfNeeded
  exit 1
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $script + '" -NoBrowser') `
  -WorkingDirectory $root

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable

$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host ''
Write-Host ('Задача «' + $taskName + '» создана.') -ForegroundColor Green
Write-Host 'Приложение будет запускаться само при включении компьютера:' -ForegroundColor DarkGray
Write-Host 'без входа в систему и без окна на экране (режим сервера).' -ForegroundColor DarkGray
Write-Host ''
Write-Host 'Запустить прямо сейчас, без перезагрузки:' -ForegroundColor DarkGray
Write-Host ('   Start-ScheduledTask -TaskName "' + $taskName + '"') -ForegroundColor DarkGray
Write-Host 'Отключить автозапуск:' -ForegroundColor DarkGray
Write-Host '   install-autostart.cmd с ключом -Remove' -ForegroundColor DarkGray
Write-Host ''
Pause-IfNeeded
