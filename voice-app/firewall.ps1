# «Волна» — открытие портов в брандмауэре Windows.
#
# Запускать ОТ ИМЕНИ АДМИНИСТРАТОРА:
#   правый клик по firewall.cmd → «Запуск от имени администратора»
#
# Открывает:
#   TCP 8443      — интерфейс и сигналинг (обязательно)
#   TCP 7881      — резервный путь медиа, если UDP заблокирован
#   UDP 7882-7892 — голос и демонстрация экрана
#   TCP 7880      — сам LiveKit, наружу НЕ открываем (он нужен только локально, за прокси)

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host ''
  Write-Host 'Нужны права администратора.' -ForegroundColor Red
  Write-Host 'Закройте окно и запустите firewall.cmd через «Запуск от имени администратора».' -ForegroundColor Yellow
  Write-Host ''
  Read-Host 'Enter — закрыть'
  exit 1
}

function Add-VolnaRule {
  param([string]$Name, [string]$Protocol, [string]$Ports, [string]$Profiles)

  $existing = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host ('Уже есть: ' + $Name) -ForegroundColor DarkGray
    return
  }
  New-NetFirewallRule -DisplayName $Name -Direction Inbound -Action Allow `
    -Protocol $Protocol -LocalPort $Ports -Profile $Profiles | Out-Null
  Write-Host ('Добавлено: ' + $Name + '  (' + $Protocol + ' ' + $Ports + ')') -ForegroundColor Green
}

Write-Host 'Настраиваю брандмауэр для «Волны»…' -ForegroundColor Cyan
Write-Host ''
Add-VolnaRule -Name 'Волна: интерфейс и сигналинг (TCP 8443)' -Protocol 'TCP' -Ports '8443'      -Profiles 'Domain,Private'
Add-VolnaRule -Name 'Волна: медиа TCP (7881)'                -Protocol 'TCP' -Ports '7881'      -Profiles 'Domain,Private'
Add-VolnaRule -Name 'Волна: медиа UDP (7882-7892)'           -Protocol 'UDP' -Ports '7882-7892' -Profiles 'Domain,Private'

# Сети, помеченные Windows как «общедоступные», по умолчанию блокируют подключения.
# Дома и в офисе это обычно лишняя строгость, поэтому спрашиваем отдельно.
$public = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq 'Public' })
if ($public.Count -gt 0) {
  Write-Host ''
  Write-Host 'Windows считает «общедоступными» такие сети:' -ForegroundColor Yellow
  foreach ($p in $public) {
    Write-Host ('   • ' + $p.Name + '   (' + $p.InterfaceAlias + ')') -ForegroundColor Yellow
  }
  Write-Host 'В них подключения к приложению сейчас будут блокироваться.' -ForegroundColor Yellow
  Write-Host 'Дома или в офисе это обычно лишняя строгость — можно разрешить.' -ForegroundColor DarkGray
  $answer = Read-Host 'Разрешить подключения и в этих сетях? (д/н)'

  if ($answer -match '^(д|да|y|yes)$') {
    Add-VolnaRule -Name 'Волна: интерфейс и сигналинг в публичных сетях (TCP 8443)' -Protocol 'TCP' -Ports '8443'      -Profiles 'Public'
    Add-VolnaRule -Name 'Волна: медиа TCP в публичных сетях (7881)'                -Protocol 'TCP' -Ports '7881'      -Profiles 'Public'
    Add-VolnaRule -Name 'Волна: медиа UDP в публичных сетях (7882-7892)'           -Protocol 'UDP' -Ports '7882-7892' -Profiles 'Public'
    Write-Host 'Разрешено.' -ForegroundColor Green
  } else {
    Write-Host 'Оставлено как есть: из этих сетей подключения будут блокироваться.' -ForegroundColor DarkGray
    Write-Host 'Понадобится позже — просто запустите firewall.cmd снова.' -ForegroundColor DarkGray
  }
}

Write-Host ''
Write-Host 'Готово.' -ForegroundColor Green
Write-Host 'Для доступа из интернета нужен ещё проброс портов на роутере — см. README, раздел 7.' -ForegroundColor DarkGray
Write-Host ''
Read-Host 'Enter — закрыть'
