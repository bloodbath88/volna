#!/usr/bin/env bash
#
# «Волна» — автоматическая установка на VPS (Ubuntu/Debian, с доменом).
#
# Что делает за один запуск:
#   1) ставит нужные программы (curl, tar, certbot)
#   2) проверяет, что домен указывает на этот сервер
#   3) открывает порты в файрволе
#   4) скачивает Node.js и голосовой сервер, ставит библиотеки
#   5) выпускает сертификат Let's Encrypt (если домен настроен)
#   6) включает режим сервера: адрес https://ваш-домен без порта
#   7) настраивает автозапуск systemd и запускает приложение
#
# Запуск (от root, из папки приложения):
#   sudo ./install-vps.sh
#   sudo ./install-vps.sh --domain voice.example.com --email me@example.com
#   sudo ./install-vps.sh --with-turn            — адрес с портом 8443 + прямой TURN/TLS
#   sudo ./install-vps.sh --cert-only            — только выпустить/перевыпустить сертификат
#   sudo ./install-vps.sh --port 8443            — задать порт приложения вручную
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

DOMAIN=""
EMAIL=""
WITH_TURN=0
CERT_ONLY=0
APP_PORT=""
PORT_SET=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift; if [[ $# -gt 0 ]]; then shift; fi ;;
    --email) EMAIL="${2:-}"; shift; if [[ $# -gt 0 ]]; then shift; fi ;;
    --port) APP_PORT="${2:-}"; PORT_SET=1; shift; if [[ $# -gt 0 ]]; then shift; fi ;;
    --with-turn) WITH_TURN=1; shift ;;
    --cert-only) CERT_ONLY=1; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) printf 'Неизвестный параметр: %s\n' "$1"; exit 1 ;;
  esac
done

say() { printf '%s\n' "$*"; }
die() { printf '\n%s\n\n' "$*" >&2; exit 1; }

[[ "$(id -u)" == "0" ]] || die 'Запускать от root:   sudo ./install-vps.sh'
[[ -f "$ROOT/start.sh" && -f "$ROOT/server/setup.js" ]] || die 'Рядом нет файлов приложения — распакуйте архив целиком и запускайте скрипт из его папки.'

if [[ "$PORT_SET" == "0" ]]; then
  if [[ "$WITH_TURN" == "1" ]]; then APP_PORT="8443"; else APP_PORT="443"; fi
fi

say ''
say '  Волна — автоматическая установка на сервер'
say '  ----------------------------------------------'

# ── домен и e-mail ────────────────────────────────────────────
if [[ -z "$DOMAIN" ]]; then
  [[ -t 0 ]] || die 'Укажите домен:  sudo ./install-vps.sh --domain voice.example.com --email me@example.com'
  read -r -p '  Домен (например, voice.example.com): ' DOMAIN
fi
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "«$DOMAIN» не похоже на доменное имя."

if [[ -z "$EMAIL" ]]; then
  [[ -t 0 ]] || die 'Укажите e-mail:  --email me@example.com'
  read -r -p "  E-mail для сертификата (Let's Encrypt): " EMAIL
fi
[[ "$EMAIL" == *@*.* ]] || die "«$EMAIL» не похоже на адрес почты."

# ── программы ─────────────────────────────────────────────────
say ''
say '  Проверяю и устанавливаю нужные программы…'
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y -qq curl tar >/dev/null 2>&1 || true
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y -q curl tar >/dev/null 2>&1 || true
else
  die 'Не найден apt-get или dnf. Установите вручную: curl, tar, certbot'
fi
command -v curl >/dev/null 2>&1 || die 'Не удалось установить curl.'
command -v tar >/dev/null 2>&1 || die 'Не удалось установить tar.'

HAVE_CERTBOT=0
if command -v certbot >/dev/null 2>&1; then
  HAVE_CERTBOT=1
  say '  certbot уже установлен'
else
  say '  Устанавливаю certbot…'
  if command -v apt-get >/dev/null 2>&1; then
    apt-get install -y -qq certbot >/dev/null 2>&1 && HAVE_CERTBOT=1 || true
    if [[ "$HAVE_CERTBOT" != "1" && -x /usr/bin/snap ]]; then
      snap install --classic certbot >/dev/null 2>&1 || true
      if [[ -x /snap/bin/certbot ]]; then ln -sf /snap/bin/certbot /usr/bin/certbot; HAVE_CERTBOT=1; fi
    fi
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q epel-release >/dev/null 2>&1 || true
    dnf install -y -q certbot >/dev/null 2>&1 && HAVE_CERTBOT=1 || true
  fi
  if [[ "$HAVE_CERTBOT" == "1" ]]; then
    say '  certbot готов'
  else
    say '  ВНИМАНИЕ: certbot недоступен — приложение будет с самоподписанным сертификатом.'
  fi
fi

# ── домен указывает на нас? ───────────────────────────────────
PUB_IP="$(curl -fsS --max-time 15 https://api.ipify.org 2>/dev/null || true)"
if [[ -z "$PUB_IP" ]]; then
  PUB_IP="$(curl -fsS --max-time 15 https://ifconfig.me 2>/dev/null || true)"
fi
DNS_IP="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)"

say ''
say "  Публичный IP сервера:       ${PUB_IP:-не удалось определить}"
say "  Домен $DOMAIN указывает на: ${DNS_IP:-нет данных}"

DNS_OK=0
if [[ -n "$PUB_IP" && "$DNS_IP" == "$PUB_IP" ]]; then DNS_OK=1; fi

if [[ "$DNS_OK" != "1" ]]; then
  say ''
  say '  ВНИМАНИЕ: домен пока не указывает на этот сервер.'
  say "  Добавьте у регистратора домена запись: тип A, значение $PUB_IP"
  say '  Обычно это занимает от 5 до 30 минут.'
  say ''
  say '  Продолжить можно уже сейчас: приложение заработает с самоподписанным'
  say '  сертификатом, а сертификат Let'"'"'s Encrypt выпустите позже командой:'
  say '     sudo ./install-vps.sh --cert-only'
  if [[ "$CERT_ONLY" != "1" && -t 0 ]]; then
    read -r -p '  Продолжить установку без сертификата? (д/н): ' ANSWER
    case "$ANSWER" in
      д|Д|y|Y|да|yes|YES) ;;
      *) say ''; say '  Установка остановлена. Настройте домен и запустите скрипт снова.'; exit 1 ;;
    esac
  fi
fi

# ── порты и файрвол ───────────────────────────────────────────
if [[ "$CERT_ONLY" != "1" ]]; then
  say ''
  say '  Настраиваю файрвол…'
  if [[ -x "$ROOT/firewall.sh" ]]; then
    "$ROOT/firewall.sh" >/dev/null 2>&1 || say '  Не удалось настроить ufw — запустите вручную: sudo ./firewall.sh'
  fi
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${APP_PORT}\$"; then
      say "  ВНИМАНИЕ: порт $APP_PORT уже занят другой программой (частая причина — nginx или apache)."
      say "  Остановите её либо запустите установку с другим портом:  sudo ./install-vps.sh --port 8443"
    fi
  fi
  say ''
  say '  Не забудьте открыть порты в панели управления хостингом:'
  say "     ${APP_PORT}/TCP  — приложение"
  say '     7881/TCP и 7882-7892/UDP — голос и демонстрация экрана'
  say '     80/TCP — нужен только для выпуска сертификата'
fi

# ── подготовка приложения ─────────────────────────────────────
NODE_BIN="$ROOT/runtime/node/bin/node"
if [[ "$CERT_ONLY" != "1" ]]; then
  say ''
  say '  Готовлю приложение: Node.js, голосовой сервер, библиотеки (~60 МБ, один раз)…'
  chmod +x "$ROOT/start.sh" "$ROOT/firewall.sh" "$ROOT/install-autostart.sh" 2>/dev/null || true
  "$ROOT/start.sh" --provision
  [[ -x "$NODE_BIN" ]] || NODE_BIN="$(command -v node || true)"
  [[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || die 'Не удалось подготовить Node.js — смотрите сообщения выше.'
fi

# ── сертификат Let's Encrypt ──────────────────────────────────
LE_LIVE="/etc/letsencrypt/live/$DOMAIN"
CERT_FILE="$LE_LIVE/fullchain.pem"
KEY_FILE="$LE_LIVE/privkey.pem"
HAVE_CERT=0

if [[ -f "$CERT_FILE" && -f "$KEY_FILE" ]]; then
  HAVE_CERT=1
  say ''
  say "  Сертификат Let's Encrypt уже есть — использую его."
elif [[ "$HAVE_CERTBOT" == "1" && "$DNS_OK" == "1" ]]; then
  say ''
  say "  Выпускаю сертификат Let's Encrypt (порт 80 должен быть свободен и открыт)…"
  if certbot certonly --standalone -d "$DOMAIN" --agree-tos -m "$EMAIL" --non-interactive --keep-until-expiring >/tmp/volna-certbot.log 2>&1; then
    HAVE_CERT=1
    say '  Сертификат получен.'
  else
    say '  Не удалось выпустить сертификат. Подробности: /tmp/volna-certbot.log'
    say '  Продолжаю с самоподписанным. Повторить позже:  sudo ./install-vps.sh --cert-only'
  fi
fi

# ── режим сервера ─────────────────────────────────────────────
say ''
say '  Настраиваю режим сервера…'
if [[ "$HAVE_CERT" == "1" ]]; then
  if [[ "$WITH_TURN" == "1" ]]; then
    "$NODE_BIN" "$ROOT/server/make-public.js" --domain "$DOMAIN" --cert "$CERT_FILE" --key "$KEY_FILE" --port "$APP_PORT"
  else
    "$NODE_BIN" "$ROOT/server/make-public.js" --domain "$DOMAIN" --cert "$CERT_FILE" --key "$KEY_FILE" --port "$APP_PORT" --no-turn
  fi
else
  "$NODE_BIN" "$ROOT/server/make-public.js" --domain "$DOMAIN" --port "$APP_PORT" --no-turn
fi

"$NODE_BIN" "$ROOT/server/setup.js" | tail -n 14

# ── запуск и автозапуск ───────────────────────────────────────
if [[ "$CERT_ONLY" == "1" ]]; then
  say ''
  say '  Перезапускаю службу…'
  systemctl restart volna 2>/dev/null || say '  Служба ещё не настроена — запустите приложение: ./start.sh'
else
  say ''
  say '  Включаю автозапуск при загрузке сервера…'
  VOLNA_USER=root "$ROOT/install-autostart.sh" | tail -n 6 || die 'Не удалось настроить автозапуск.'
fi

if [[ "$HAVE_CERT" == "1" ]]; then
  mkdir -p /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/volna.sh <<'HOOK'
#!/bin/sh
systemctl restart volna
HOOK
  chmod +x /etc/letsencrypt/renewal-hooks/deploy/volna.sh
fi

# ── итог ──────────────────────────────────────────────────────
sleep 3
PORT="$("$NODE_BIN" -e 'process.stdout.write(String(require(process.argv[1]).port))' "$ROOT/config.json")"
if [[ "$PORT" == "443" ]]; then URL="https://$DOMAIN"; else URL="https://$DOMAIN:$PORT"; fi

say ''
say '  ================================================'
say '   ГОТОВО'
say '  ================================================'
say "   Адрес для участников:  $URL"
"$NODE_BIN" -e 'process.stdout.write("   Пароль комнаты:        " + require(process.argv[1]).roomPassword + "\n")' "$ROOT/config.json"
if [[ "$HAVE_CERT" == "1" ]]; then
  say "   Сертификат:            Let's Encrypt (продлевается автоматически)"
else
  say '   Сертификат:            самоподписанный (участники один раз нажмут «Перейти на сайт»)'
fi
if [[ "$WITH_TURN" == "1" ]]; then
  say '   TURN:                  включён (порт 443 — TURN/TLS)'
else
  say '   TURN:                  выключен (адрес без порта)'
fi
say ''
say '   Обязательно проверьте с телефона через мобильный интернет:'
say "      $URL"
say ''
say '   Состояние службы:  systemctl status volna'
say '   Журнал:            journalctl -u volna -f'
say '   Остановить:        ./start.sh --stop'
say ''
