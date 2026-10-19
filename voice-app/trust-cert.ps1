# «Волна» — доверие сертификату (необязательный шаг).
#
# Зачем: сертификат у приложения самоподписанный, поэтому браузер один раз предупреждает
# «Подключение не защищено». После этого скрипта предупреждение исчезает для адресов,
# на которые выпущен сертификат (localhost и адреса этого компьютера), и окно приложения
# открывается сразу в комнате.
#
# Запуск:        right-click по trust-cert.cmd → «Запуск от имени администратора» не нужен,
#                сертификат ставится только для текущего пользователя.
# Отменить:      trust-cert.cmd -Remove
#
# Что именно делает: добавляет public/../certs/server.crt (сертификат этой установки)
# в личное хранилище «Доверенные корневые центры сертификации» текущего пользователя.
# Windows может показать окно подтверждения — это ожидаемо, нажмите «Да».

param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$crtPath = Join-Path $root 'certs\server.crt'

function Pause-IfNeeded {
  if (-not $env:VOLNA_NO_PAUSE) { Read-Host 'Enter — закрыть' }
}

if (-not (Test-Path $crtPath)) {
  Write-Host ''
  Write-Host 'Не найден сертификат: ' + $crtPath -ForegroundColor Red
  Write-Host 'Сначала запустите приложение (start.cmd) — сертификат создаётся при первом запуске.' -ForegroundColor Yellow
  Write-Host ''
  Pause-IfNeeded
  exit 1
}

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($crtPath)
$thumb = $cert.Thumbprint

Write-Host ''
Write-Host 'Сертификат этой установки «Волны»:' -ForegroundColor DarkGray
Write-Host ('   кому выдан:  ' + $cert.Subject) -ForegroundColor DarkGray
Write-Host ('   действует до: ' + $cert.NotAfter.ToString('dd.MM.yyyy')) -ForegroundColor DarkGray
Write-Host ('   отпечаток:   ' + $thumb) -ForegroundColor DarkGray
Write-Host ''

$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'CurrentUser')

if ($Remove) {
  $store.Open('ReadWrite')
  try {
    $found = @()
    foreach ($c in $store.Certificates) { if ($c.Thumbprint -eq $thumb) { $found += $c } }
    if ($found.Count -eq 0) {
      Write-Host 'Этого сертификата в доверенных нет — ничего убирать не нужно.' -ForegroundColor DarkGray
    } else {
      foreach ($c in $found) { $store.Remove($c) }
      Write-Host 'Сертификат убран из доверенных. Браузер снова будет предупреждать.' -ForegroundColor Green
    }
  } finally {
    $store.Close()
  }
  Write-Host ''
  Pause-IfNeeded
  exit 0
}

$store.Open('ReadWrite')
try {
  $already = $false
  foreach ($c in $store.Certificates) { if ($c.Thumbprint -eq $thumb) { $already = $true } }
  if ($already) {
    Write-Host 'Сертификат уже доверенный — ничего делать не нужно.' -ForegroundColor Green
  } else {
    $store.Add($cert)
    Write-Host 'Готово: сертификат добавлен в доверенные для вашей учётной записи.' -ForegroundColor Green
  }
} finally {
  $store.Close()
}

Write-Host ''
Write-Host 'Что дальше: закройте окна браузера с приложением и откройте ярлык «Волна» заново.' -ForegroundColor DarkGray
Write-Host 'Предупреждения о сертификате больше не будет (для этого компьютера).' -ForegroundColor DarkGray
Write-Host 'Отменить решение: trust-cert.cmd -Remove' -ForegroundColor DarkGray
Write-Host ''
Pause-IfNeeded
