#!/usr/bin/env bash
#
# «Волна» — открыть порты в файрволе (Ubuntu/Debian, ufw).
# Запускать от root:   sudo ./firewall.sh
#
set -euo pipefail

if [[ "$(id -u)" != "0" ]]; then
  echo 'Нужны права root:  sudo ./firewall.sh'
  exit 1
fi

if ! command -v ufw >/dev/null 2>&1; then
  echo 'ufw не установлен. Установите:  sudo apt-get install -y ufw'
  exit 1
fi

ufw allow 8443/tcp comment 'Volna web+signaling'
ufw allow 7881/tcp comment 'Volna media TCP'
ufw allow 7882:7892/udp comment 'Volna media UDP'
ufw allow 443/tcp comment 'Volna TURN/TLS'
ufw allow 3478/udp comment 'Volna TURN'
ufw allow 3478/tcp comment 'Volna TURN'
ufw allow 50000:51000/udp comment 'Volna TURN relay'

# Если файрвол ещё выключен — включаем, но сначала обязательно разрешаем SSH,
# иначе можно потерять доступ к серверу.
if ! ufw status | grep -q 'Status: active'; then
  echo
  echo 'Файрвол выключен — включаю, предварительно разрешив SSH.'
  ufw allow OpenSSH
  ufw --force enable
fi

echo
ufw status verbose
echo
echo 'Готово.'
echo 'Не забудьте открыть те же порты в панели управления вашего хостинга —'
echo 'там обычно есть отдельный «сетевой экран», не связанный с ufw.'
