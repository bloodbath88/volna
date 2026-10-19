# «Волна» — установка настольного приложения на Windows.
#
#   install-desktop.cmd                — установить (ярлыки в «Пуск» и на рабочем столе)
#   install-desktop.cmd -Remove        — удалить ярлыки и (по желанию) скачанный Electron
#
# Что делает:
#   1) проверяет Node.js (системный или портативный из папки runtime — при необходимости
#      запускает start.ps1, который его скачает);
#   2) ставит Electron — движок окна приложения (~150 МБ, один раз, нужен интернет);
#   3) создаёт ярлык «Волна»: своё окно без адресной строки и вкладок, со своей иконкой.
#
# Само приложение — папка desktop рядом (main.js): оно само поднимает сервер, входит
# в комнату и останавливает сервер, когда окно закрывают.

param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
$desktopDir = Join-Path $root 'desktop'
$electronExe = Join-Path $desktopDir 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $root 'public\icon.ico'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Волна'
$lnkStart = Join-Path $startMenu 'Волна.lnk'
$lnkDesktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Волна.lnk'
$shell = New-Object -ComObject WScript.Shell

function Pause {
  if (-not $env:VOLNA_NO_PAUSE) { Read-Host 'Enter — закрыть' }
}

function Find-Node {
  $onPath = Get-Command node -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $portable = Join-Path $root 'runtime\node\node.exe'
  if (Test-Path $portable) { return $portable }
  return ''
}

if ($Remove) {
  foreach ($f in @($lnkStart, $lnkDesktop)) {
    if (Test-Path $f) { Remove-Item $f -Force; Write-Host ('Удалён ярлык: ' + $f) -ForegroundColor DarkGray }
  }
  if (Test-Path $startMenu) {
    $left = Get-ChildItem $startMenu -ErrorAction SilentlyContinue
    if (-not $left) { Remove-Item $startMenu -Force -ErrorAction SilentlyContinue }
  }
  Write-Host ''
  Write-Host 'Настольное приложение удалено из «Пуска» и с рабочего стола.' -ForegroundColor Green
  Write-Host 'Сам Electron (папка desktop\node_modules) не тронут — он занимает место только у вас.' -ForegroundColor DarkGray
  Write-Host 'Удалить и его: install-desktop.cmd -Remove -Purge' -ForegroundColor DarkGray
  Write-Host ''
  Pause
  exit 0
}

if ($args -contains '-Purge') {
  $nm = Join-Path $desktopDir 'node_modules'
  if (Test-Path $nm) { Remove-Item $nm -Recurse -Force; Write-Host 'Папка desktop\node_modules удалена.' -ForegroundColor DarkGray }
}

Write-Host ''
Write-Host 'Волна — установка настольного приложения' -ForegroundColor Cyan
Write-Host '----------------------------------------' -ForegroundColor DarkGray

# 1. Node.js
$node = Find-Node
if (-not $node) {
  Write-Host '  Node.js не найден — запускаю start.ps1, он скачает портативную версию…' -ForegroundColor Yellow
  $ps = Join-Path $root 'start.ps1'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps -NoBrowser
  $node = Find-Node
}
if (-not $node) {
  Write-Host '  Не удалось подготовить Node.js. Запустите start.cmd, дождитесь запуска и повторите.' -ForegroundColor Red
  Pause
  exit 1
}
Write-Host ('  Node.js: ' + $node) -ForegroundColor DarkGray

# 2. Electron
if (-not (Test-Path $electronExe)) {
  Write-Host '  Ставлю движок окна (Electron, ~150 МБ, один раз)…' -ForegroundColor Cyan
  $npmCli = Join-Path (Split-Path $node -Parent) 'node_modules\npm\bin\npm-cli.js'
  Push-Location $desktopDir
  try {
    if (Test-Path $npmCli) { & $node $npmCli install --no-audit --no-fund --loglevel=error }
    else { & npm install --no-audit --no-fund --loglevel=error }
  } finally {
    Pop-Location
  }
  if (-not (Test-Path $electronExe)) {
    Write-Host '  Не удалось скачать Electron. Проверьте интернет и повторите.' -ForegroundColor Red
    Write-Host '  (Можно поставить вручную: cd desktop; npm install)' -ForegroundColor DarkGray
    Pause
    exit 1
  }
}
Write-Host '  Движок окна готов' -ForegroundColor Green

# 3. Ярлыки
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
$arguments = '"' + $desktopDir + '"'
foreach ($lnk in @($lnkStart, $lnkDesktop)) {
  $sc = $shell.CreateShortcut($lnk)
  $sc.TargetPath = $electronExe
  $sc.Arguments = $arguments
  $sc.WorkingDirectory = $root
  $sc.Description = 'Волна — голосовая связь и демонстрация экрана'
  if (Test-Path $icon) { $sc.IconLocation = $icon }
  $sc.Save()
}

Write-Host ''
Write-Host ('Ярлык в «Пуск»:   ' + $lnkStart) -ForegroundColor Green
Write-Host ('Ярлык на столе:   ' + $lnkDesktop) -ForegroundColor Green
Write-Host ''
Write-Host 'Теперь «Волна» — обычное приложение Windows: своё окно, свой значок,' -ForegroundColor DarkGray
Write-Host 'без адресной строки и вкладок. Оно само поднимет сервер и войдёт в комнату.' -ForegroundColor DarkGray
Write-Host 'Удалить: install-desktop.cmd -Remove' -ForegroundColor DarkGray
Write-Host ''
Pause
