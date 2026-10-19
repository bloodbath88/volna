# «Волна» — ярлыки на рабочем столе Windows.
#
#   create-shortcut.cmd                             ярлык «Волна» и «Волна — остановить»
#   create-shortcut.cmd -InviteUrl "https://...#i=…" дополнительно «Волна — приглашение»
#   create-shortcut.cmd -Remove                     удалить созданные ярлыки
#
# Ярлык «Волна» запускает приложение (сервер + окно) без окна консоли.
# Ярлык «Волна — приглашение» открывает ссылку-приглашение в отдельном окне: участнику
# достаточно двойного клика — приложение подключится само.

param([string]$InviteUrl = '', [switch]$Remove)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$desktop = [Environment]::GetFolderPath('Desktop')
$icon = Join-Path $root 'public\icon.ico'
$shell = New-Object -ComObject WScript.Shell

$lnkMain = Join-Path $desktop 'Волна.lnk'
$lnkStop = Join-Path $desktop 'Волна — остановить.lnk'
$lnkInvite = Join-Path $desktop 'Волна — приглашение.lnk'
$urlInvite = Join-Path $root 'Волна — приглашение.url'

if ($Remove) {
  foreach ($f in @($lnkMain, $lnkStop, $lnkInvite, $urlInvite)) {
    if (Test-Path $f) { Remove-Item $f -Force; Write-Host ('Удалён: ' + $f) -ForegroundColor DarkGray }
  }
  Write-Host 'Готово.' -ForegroundColor Green
  if (-not $env:VOLNA_NO_PAUSE) { Read-Host 'Enter — закрыть' }
  exit 0
}

$startPs = Join-Path $root 'start.ps1'
$stopPs = Join-Path $root 'stop.ps1'
$openPs = Join-Path $root 'open-app.ps1'

if (-not (Test-Path $startPs)) {
  Write-Host 'Не найден start.ps1 рядом с этим файлом.' -ForegroundColor Red
  if (-not $env:VOLNA_NO_PAUSE) { Read-Host 'Enter — закрыть' }
  exit 1
}

function New-Lnk($path, $arguments, $description, $target = 'powershell.exe') {
  $sc = $shell.CreateShortcut($path)
  $sc.TargetPath = $target
  $sc.Arguments = $arguments
  $sc.WorkingDirectory = $root
  $sc.Description = $description
  if (Test-Path $icon) { $sc.IconLocation = $icon }
  $sc.Save()
}

# Если установлено настольное приложение (desktop + Electron), ярлык «Волна»
# открывает его собственное окно вместо окна браузера.
$electron = Join-Path $root 'desktop\node_modules\electron\dist\electron.exe'
$desktopApp = Join-Path $root 'desktop'
$useNative = Test-Path $electron

# «Волна» — запуск приложения: своё окно (если установлено) или окно браузера
if ($useNative) {
  New-Lnk $lnkMain ('"' + $desktopApp + '"') 'Волна — голосовая связь' $electron
} else {
  New-Lnk $lnkMain ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $startPs + '" -Shortcut') 'Волна — голосовая связь'
}

# «Волна — остановить»
if (Test-Path $stopPs) {
  New-Lnk $lnkStop ('-NoProfile -ExecutionPolicy Bypass -File "' + $stopPs + '"') 'Волна — остановить приложение'
}

if ($InviteUrl) {
  if (Test-Path $openPs) {
    New-Lnk $lnkInvite ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $openPs + '" -Url "' + $InviteUrl + '"') 'Волна — вход по приглашению'
  }
  # Переносимый ярлык .url: его можно отправить участнику — откроется в браузере по умолчанию
  $lines = @('[InternetShortcut]', ('URL=' + $InviteUrl))
  if (Test-Path $icon) { $lines += ('IconFile=' + $icon) }
  [System.IO.File]::WriteAllLines($urlInvite, $lines)
}

Write-Host ''
Write-Host ('Ярлык создан: ' + $lnkMain) -ForegroundColor Green
if (Test-Path $stopPs) { Write-Host ('Ярлык создан: ' + $lnkStop) -ForegroundColor Green }
if ($InviteUrl) {
  Write-Host ('Ярлык создан: ' + $lnkInvite) -ForegroundColor Green
  Write-Host ('Файл для отправки участнику: ' + $urlInvite) -ForegroundColor Green
}
Write-Host ''
Write-Host 'Теперь «Волну» можно запускать с рабочего стола.' -ForegroundColor DarkGray
if (-not $InviteUrl) {
  Write-Host 'Ярлык-приглашение для участника: create-shortcut.cmd -InviteUrl "<ссылка из кнопки «Пригласить»>"' -ForegroundColor DarkGray
}
Write-Host ''
if (-not $env:VOLNA_NO_PAUSE) { Read-Host 'Enter — закрыть' }
