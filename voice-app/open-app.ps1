# «Волна» — открыть окно приложения.
#
#   .\open-app.ps1                          окно на этом компьютере (адрес из config.json)
#   .\open-app.ps1 -Url "https://...#i=..."  окно по ссылке-приглашению
#   .\open-app.ps1 -Browser chrome           какой браузер предпочесть (chrome или edge)
#
# Если сервер ещё не запущен, скрипт просто запускает приложение целиком (start.ps1).

param([string]$Url = '', [string]$Browser = '')

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$cfgPath = Join-Path $root 'config.json'

function Test-Health([string]$Url) {
  # у самоподписанного сертификата Invoke-RestMethod на части машин срывает TLS-рукопожатие
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

function Find-Browser([string]$prefer) {
  $chrome = @()
  $edge = @()
  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
    if (-not $base) { continue }
    $chrome += (Join-Path $base 'Google\Chrome\Application\chrome.exe')
    $edge += (Join-Path $base 'Microsoft\Edge\Application\msedge.exe')
  }
  $groups = @()
  if ($prefer -eq 'chrome') { $groups = @($chrome, $edge) }
  elseif ($prefer -eq 'edge') { $groups = @($edge, $chrome) }
  else { $groups = @($edge, $chrome) }
  foreach ($group in $groups) {
    foreach ($exe in $group) { if ($exe -and (Test-Path $exe)) { return $exe } }
  }
  return ''
}

$target = $Url

if (-not $target) {
  if (-not (Test-Path $cfgPath)) {
    try { (New-Object -ComObject WScript.Shell).Popup('Сначала запустите start.cmd — приложение ещё не настроено.', 0, 'Волна', 48) | Out-Null } catch { }
    exit 1
  }
  $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $target = 'https://localhost:' + $cfg.port
  if (-not (Test-Health $target)) {
    $starter = Join-Path $root 'start.ps1'
    if (Test-Path $starter) {
      Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $starter + '" -Shortcut')
      exit 0
    }
  }
}

$exe = Find-Browser $Browser
if ($exe) {
  Start-Process -FilePath $exe -ArgumentList @('--app=' + $target)
} else {
  Start-Process $target
}
