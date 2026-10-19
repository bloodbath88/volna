#!/usr/bin/env bash
#
# «Волна» — автозапуск при загрузке сервера (systemd).
# Запускать от root:   sudo ./install-autostart.sh
# Отменить:            sudo ./install-autostart.sh --remove
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT=/etc/systemd/system/volna.service
SERVICE_USER="${VOLNA_USER:-${SUDO_USER:-root}}"

if [[ "$(id -u)" != "0" ]]; then
  echo 'Нужны права root:  sudo ./install-autostart.sh'
  exit 1
fi

if [[ "${1:-}" == "--remove" ]]; then
  systemctl disable --now volna 2>/dev/null || true
  rm -f "$UNIT"
  systemctl daemon-reload
  echo 'Автозапуск отключён.'
  exit 0
fi

chmod +x "$ROOT/start.sh" "$ROOT/firewall.sh" 2>/dev/null || true

cat > "$UNIT" <<EOF
[Unit]
Description=Volna - voice chat (LiveKit + web server)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT
ExecStart=$ROOT/start.sh --foreground
Restart=always
RestartSec=5
User=$SERVICE_USER
Environment=HOME=$ROOT

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now volna
sleep 2
systemctl --no-pager --full status volna || true

echo
echo 'Автозапуск включён: приложение стартует вместе с сервером.'
echo "Журнал:  journalctl -u volna -f"
echo 'Отключить:  sudo ./install-autostart.sh --remove'
