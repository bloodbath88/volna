#!/usr/bin/env bash
#
# «Волна» — запуск на Linux.
# Первый запуск сам скачает Node.js и LiveKit, поставит библиотеки,
# создаст сертификат и конфигурацию, запустит сервисы и напечатает адрес.
#
#   ./start.sh              — запустить (оба сервиса в фоне)
#   ./start.sh --foreground — запустить в переднем плане (режим systemd)
#   ./start.sh --provision  — только подготовить (скачать и настроить, не запуская)
#   ./start.sh --stop       — остановить
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

RUN_DIR="$ROOT/run"
RUNTIME_DIR="$ROOT/runtime"
NODE_DIR="$RUNTIME_DIR/node"
LK_DIR="$ROOT/livekit"
LK_BIN="$LK_DIR/livekit-server"
LK_CFG="$LK_DIR/livekit.yaml"

say() { printf '%s\n' "$*"; }
die() { printf '\n%s\n\n' "$*" >&2; exit 1; }

mkdir -p "$RUN_DIR" "$RUNTIME_DIR"

stop_all() {
  for name in server livekit; do
    f="$RUN_DIR/$name.pid"
    [[ -f "$f" ]] || continue
    p="$(cat "$f" 2>/dev/null || true)"
    if [[ -n "${p:-}" ]] && kill -0 "$p" 2>/dev/null; then
      kill "$p" 2>/dev/null || true
      say "  остановлен процесс $p ($name)"
    fi
    rm -f "$f"
  done
}

if [[ "${1:-}" == "--stop" ]]; then
  stop_all
  exit 0
fi

FOREGROUND=0
[[ "${1:-}" == "--foreground" ]] && FOREGROUND=1

PROVISION=0
[[ "${1:-}" == "--provision" ]] && PROVISION=1

say ''
say '  Волна — голосовая связь'
say '  ----------------------------------------------'

for tool in curl tar; do
  command -v "$tool" >/dev/null 2>&1 || die "Не хватает программы «$tool». Установите её:  sudo apt-get install -y $tool"
done

# ── 1. Node.js ────────────────────────────────────────────────
NODE_EXE=""
if command -v node >/dev/null 2>&1; then
  v="$(node -v 2>/dev/null || echo v0)"
  major="${v#v}"; major="${major%%.*}"
  if [[ "$major" =~ ^[0-9]+$ ]] && (( major >= 18 )); then
    NODE_EXE="$(command -v node)"
  fi
fi
if [[ -z "$NODE_EXE" && -x "$NODE_DIR/bin/node" ]]; then
  NODE_EXE="$NODE_DIR/bin/node"
fi

if [[ -z "$NODE_EXE" ]]; then
  say '  Node.js не найден — скачиваю портативную версию (~30 МБ)…'
  case "$(uname -m)" in
    x86_64|amd64) NARCH=x64 ;;
    aarch64|arm64) NARCH=arm64 ;;
    *) die "Неизвестная архитектура: $(uname -m)" ;;
  esac
  CHANNEL=""; FILE=""
  for c in latest-v24.x latest-v22.x latest-v20.x; do
    f="$(curl -fsSL "https://nodejs.org/dist/$c/" 2>/dev/null | grep -o "node-v[0-9.]*-linux-${NARCH}\.tar\.gz" | head -1 || true)"
    if [[ -n "$f" ]]; then CHANNEL="$c"; FILE="$f"; break; fi
  done
  [[ -n "$FILE" ]] || die 'Не удалось определить версию Node.js. Проверьте доступ в интернет.'
  say "  версия: $FILE"
  curl -fL "https://nodejs.org/dist/$CHANNEL/$FILE" -o "$RUNTIME_DIR/node.tar.gz" || die 'Не удалось скачать Node.js'
  rm -rf "$RUNTIME_DIR/tmp"
  mkdir -p "$RUNTIME_DIR/tmp"
  tar -xzf "$RUNTIME_DIR/node.tar.gz" -C "$RUNTIME_DIR/tmp"
  inner="$(find "$RUNTIME_DIR/tmp" -maxdepth 1 -type d -name 'node-v*' | head -1)"
  [[ -n "$inner" ]] || die 'Неожиданная структура архива Node.js'
  rm -rf "$NODE_DIR"
  mv "$inner" "$NODE_DIR"
  rm -rf "$RUNTIME_DIR/tmp" "$RUNTIME_DIR/node.tar.gz"
  NODE_EXE="$NODE_DIR/bin/node"
  say '  Node.js готов'
fi
say "  Node.js: $("$NODE_EXE" -v)"

# ── 2. Голосовой сервер LiveKit ───────────────────────────────
if [[ ! -x "$LK_BIN" ]]; then
  say '  Голосовой сервер не найден — скачиваю (~30 МБ)…'
  case "$(uname -m)" in
    x86_64|amd64) LARCH=amd64 ;;
    aarch64|arm64) LARCH=arm64 ;;
    *) die "Неизвестная архитектура: $(uname -m)" ;;
  esac
  mkdir -p "$LK_DIR"
  url="$(curl -fsSL https://api.github.com/repos/livekit/livekit/releases/latest 2>/dev/null \
    | grep -o "https://[^\"]*livekit_[0-9.]*_linux_${LARCH}\.tar\.gz" | head -1 || true)"
  [[ -n "$url" ]] || die 'Не удалось найти сборку LiveKit. Проверьте доступ в интернет.'
  say "  версия: $(basename "$url")"
  curl -fL "$url" -o "$RUNTIME_DIR/livekit.tar.gz" || die 'Не удалось скачать LiveKit'
  tar -xzf "$RUNTIME_DIR/livekit.tar.gz" -C "$LK_DIR"
  rm -f "$RUNTIME_DIR/livekit.tar.gz"
  chmod +x "$LK_BIN" 2>/dev/null || true
  say '  Голосовой сервер готов'
fi

# ── 3. Библиотеки приложения ──────────────────────────────────
if [[ ! -d "$ROOT/node_modules" ]]; then
  say '  Устанавливаю библиотеки (один раз, ~15 МБ)…'
  NODE_ROOT="$(cd "$(dirname "$NODE_EXE")/.." && pwd)"
  NPM_CLI="$NODE_ROOT/lib/node_modules/npm/bin/npm-cli.js"
  if [[ -f "$NPM_CLI" ]]; then
    "$NODE_EXE" "$NPM_CLI" install --no-audit --no-fund --loglevel=error
  else
    npm install --no-audit --no-fund --loglevel=error
  fi
  say '  Библиотеки готовы'
fi

# ── 4. Конфигурация и сертификат ──────────────────────────────
"$NODE_EXE" "$ROOT/server/setup.js" >/dev/null

# ── 4a. Внешний адрес для голосового ядра ────────────────────
# На VPS публичный IP обычно приходит как /32 за NAT провайдера. В этом случае
# рабочий вариант — use_external_ip: true (адрес определяется через STUN), а
# node_ip нужно убрать: вместе они дают нерабочие ICE-кандидаты, и браузер
# получает «could not establish pc connection». Проверено на живом сервере.
LK_CFG="$ROOT/livekit/livekit.yaml"
if [[ -f "$LK_CFG" ]]; then
  sed -i 's/^ *use_external_ip:.*/  use_external_ip: true/' "$LK_CFG" 2>/dev/null || true
  sed -i '/^ *node_ip:/d' "$LK_CFG" 2>/dev/null || true
fi

if [[ "$PROVISION" == "1" ]]; then
  say ''
  say '  Подготовка завершена: Node.js, голосовой сервер, библиотеки и конфигурация готовы.'
  exit 0
fi

PORT="$("$NODE_EXE" -e 'process.stdout.write(String(require(process.argv[1]).port))' "$ROOT/config.json")"

# ── 4b. Адреса для ссылок-приглашений (public/addresses.json) ──
# Ссылка-приглашение должна вести на адрес, доступный участникам, а не на localhost.
"$NODE_EXE" -e '
const fs = require("fs"), path = require("path");
const root = process.argv[1];
const cfg = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
const list = [];
if (cfg.deploy && cfg.deploy.domain) {
  list.push("https://" + cfg.deploy.domain + (Number(cfg.port) === 443 ? "" : ":" + cfg.port));
}
for (const ip of ((cfg.deploy && cfg.deploy.lanIps) || [])) list.push("https://" + ip + ":" + cfg.port);
fs.writeFileSync(path.join(root, "public", "addresses.json"), JSON.stringify({ addresses: list }, null, 2) + "\n");
' "$ROOT"

# ── 5. Запуск ─────────────────────────────────────────────────
stop_all

say '  Запускаю голосовой сервер…'
nohup "$LK_BIN" --config "$LK_CFG" >"$RUN_DIR/livekit.out.log" 2>&1 &
LK_PID=$!
echo "$LK_PID" >"$RUN_DIR/livekit.pid"

if [[ "$FOREGROUND" == "1" ]]; then
  say '  Запускаю веб-сервер (передний план, для systemd)…'
  trap 'kill "$LK_PID" 2>/dev/null || true' EXIT INT TERM
  "$NODE_EXE" "$ROOT/server/server.js"
  exit 0
fi

say '  Запускаю веб-сервер…'
nohup "$NODE_EXE" "$ROOT/server/server.js" >"$RUN_DIR/server.out.log" 2>&1 &
SRV_PID=$!
echo "$SRV_PID" >"$RUN_DIR/server.pid"

ok=0
for _ in $(seq 1 40); do
  if curl -ks "https://localhost:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 0.4
done

IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
say ''
if [[ "$ok" == "1" ]]; then
  say "  Приложение запущено:   https://localhost:$PORT"
  [[ -n "${IP:-}" ]] && say "  Для других устройств:  https://$IP:$PORT"
  "$NODE_EXE" -e 'process.stdout.write("  Пароль комнаты:        " + require(process.argv[1]).roomPassword + "\n")' "$ROOT/config.json"
  say ''
  say "  Доменное имя (если настроено): см. LINUX-VPS.md"
  say '  Остановить: ./start.sh --stop'
else
  say '  Сервер не ответил за отведённое время.'
  say "  Смотрите журналы: $RUN_DIR/livekit.out.log и $RUN_DIR/server.out.log"
fi
say ''
