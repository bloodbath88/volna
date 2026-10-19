#!/usr/bin/env node
/**
 * «Волна» — подготовка окружения.
 * Создаёт/обновляет: config.json, самоподписанный сертификат, livekit/livekit.yaml
 *
 * Запуск:
 *   node server/setup.js                     — обычный режим (локальная сеть)
 *   node server/setup.js --ip 192.168.1.5    — указать основной IP вручную
 *   node server/setup.js --rotate-password   — сменить пароль комнаты
 *   node server/setup.js --public --domain voice.example.com --turn-cert C:\certs\fullchain.pem --turn-key C:\certs\privkey.pem
 *                                            — режим сервера в интернете (TURN + внешний IP)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const selfsigned = require('selfsigned');

const ROOT = path.join(__dirname, '..');
const CFG_PATH = path.join(ROOT, 'config.json');
const CERT_DIR = path.join(ROOT, 'certs');
const CERT_CRT = path.join(CERT_DIR, 'server.crt');
const CERT_KEY = path.join(CERT_DIR, 'server.key');
const CERT_META = path.join(CERT_DIR, 'meta.json');
const LK_DIR = path.join(ROOT, 'livekit');
const LK_YAML = path.join(LK_DIR, 'livekit.yaml');
const LK_BIN = path.join(LK_DIR, process.platform === 'win32' ? 'livekit-server.exe' : 'livekit-server');

const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes('--' + f);
const flagVal = (f) => {
  const i = argv.indexOf('--' + f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '';
};

const log = (m) => console.log('[Волна] ' + m);
const rand = (n) => crypto.randomBytes(n).toString('hex');

/* ------------------------------ config.json ------------------------------ */

function makeDefaultConfig() {
  return {
    serverName: 'Волна',
    port: 8443,
    roomPassword: 'volna-' + (1000 + Math.floor(Math.random() * 9000)),
    maxParticipants: 25,
    deploy: { mode: 'lan', domain: '', primaryIp: '', lanIps: [], turnCertFile: '', turnKeyFile: '' },
    livekit: { port: 7880, tcpPort: 7881, udpRange: '7882-7892', apiKey: 'API' + rand(6), apiSecret: rand(32) },
  };
}

function loadConfig() {
  if (!fs.existsSync(CFG_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
  } catch (e) {
    log('config.json повреждён — будет создан заново (старый сохранён как config.json.bak)');
    try { fs.copyFileSync(CFG_PATH, CFG_PATH + '.bak'); } catch (_) {}
    return null;
  }
}

/* ------------------------------ сеть ------------------------------ */

function findIps() {
  const out = [];
  const nics = os.networkInterfaces();
  for (const name of Object.keys(nics)) {
    for (const a of nics[name] || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue;
      out.push({ iface: name, ip: a.address });
    }
  }
  const rangeScore = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  const virtScore = (n) => /virtual|vethernet|vmware|hyper-v|loopback|docker|wsl|tailscale|zerotier|radmin|hamachi/i.test(n) ? 2 : 0;
  out.sort((a, b) => (virtScore(a.iface) + rangeScore(a.ip)) - (virtScore(b.iface) + rangeScore(b.ip)));
  return out;
}

/* ------------------------------ сертификат ------------------------------ */

function makeCert(ips, domain) {
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
  ];
  for (const ip of ips) altNames.push({ type: 7, ip });
  if (domain) altNames.push({ type: 2, value: domain });

  const cn = domain || ips[0] || 'volna.local';
  const pems = selfsigned.generate([{ name: 'commonName', value: cn }], {
    days: 3650,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
    ],
  });
  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(CERT_KEY, pems.private, { mode: 0o600 });
  fs.writeFileSync(CERT_CRT, pems.cert);
  fs.writeFileSync(CERT_META, JSON.stringify({ ips, domain, created: new Date().toISOString() }, null, 2));
  return cn;
}

function certCovers(ips, domain) {
  if (!fs.existsSync(CERT_CRT) || !fs.existsSync(CERT_KEY) || !fs.existsSync(CERT_META)) return false;
  try {
    const meta = JSON.parse(fs.readFileSync(CERT_META, 'utf8'));
    const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
    return same(meta.ips || [], ips) && (meta.domain || '') === (domain || '');
  } catch (e) {
    return false;
  }
}

/* ------------------------------ livekit.yaml ------------------------------ */

function writeLivekitYaml(cfg) {
  const lk = cfg.livekit;
  const mode = cfg.deploy.mode === 'public' ? 'public' : 'lan';
  const lines = [];

  lines.push('# Сгенерировано server/setup.js — правьте config.json, а не этот файл');
  lines.push('port: ' + lk.port);
  lines.push('');
  lines.push('rtc:');
  lines.push('  tcp_port: ' + lk.tcpPort);
  lines.push('  udp_port: ' + lk.udpRange);
  if (mode === 'public') {
    lines.push('  use_external_ip: true');
    if (cfg.deploy.publicIp) lines.push('  node_ip: ' + cfg.deploy.publicIp);
  } else {
    lines.push('  use_external_ip: false');
    if (cfg.deploy.primaryIp) lines.push('  node_ip: ' + cfg.deploy.primaryIp);
  }
  lines.push('  enable_loopback_candidate: true');
  lines.push('  allow_tcp_fallback: true');
  lines.push('');
  lines.push('keys:');
  lines.push('  ' + lk.apiKey + ': ' + lk.apiSecret);
  lines.push('');
  lines.push('room:');
  lines.push('  auto_create: true');
  lines.push('  empty_timeout: 120');
  lines.push('  departure_timeout: 20');
  lines.push('  max_participants: ' + (cfg.maxParticipants || 25));
  lines.push('');
  lines.push('audio:');
  lines.push('  active_level: 30');
  lines.push('');
  lines.push('logging:');
  lines.push('  level: info');
  lines.push('  json: false');
  lines.push('');

  const turnReady = mode === 'public' && cfg.deploy.domain && cfg.deploy.turnCertFile && cfg.deploy.turnKeyFile
    && fs.existsSync(cfg.deploy.turnCertFile) && fs.existsSync(cfg.deploy.turnKeyFile);
  if (turnReady) {
    lines.push('turn:');
    lines.push('  enabled: true');
    lines.push('  domain: ' + cfg.deploy.domain);
    lines.push('  cert_file: ' + cfg.deploy.turnCertFile);
    lines.push('  key_file: ' + cfg.deploy.turnKeyFile);
    lines.push('  udp_port: 3478');
    lines.push('  tls_port: 443');
    lines.push('');
  } else {
    lines.push('turn:');
    lines.push('  enabled: false');
    lines.push('');
  }

  fs.mkdirSync(LK_DIR, { recursive: true });
  fs.writeFileSync(LK_YAML, lines.join('\n'));
}

/* ------------------------------ main ------------------------------ */

function main() {
  let cfg = loadConfig() || makeDefaultConfig();
  if (!cfg.livekit) cfg.livekit = makeDefaultConfig().livekit;
  if (!cfg.deploy) cfg.deploy = makeDefaultConfig().deploy;

  const ips = findIps();
  const manualIp = flagVal('ip');
  const domain = flagVal('domain') || cfg.deploy.domain || '';
  const mode = hasFlag('public') ? 'public' : (flagVal('mode') || cfg.deploy.mode || 'lan');
  const publicIp = flagVal('public-ip') || cfg.deploy.publicIp || '';

  const primary = manualIp || cfg.deploy.primaryIp || (ips[0] && ips[0].ip) || '';
  const allIps = Array.from(new Set([primary, ...ips.map((x) => x.ip)].filter(Boolean)));

  if (hasFlag('rotate-password') || !cfg.roomPassword) {
    cfg.roomPassword = 'volna-' + (1000 + Math.floor(Math.random() * 9000));
  }

  cfg.deploy.mode = mode;
  cfg.deploy.domain = domain;
  cfg.deploy.primaryIp = primary;
  cfg.deploy.lanIps = allIps;
  cfg.deploy.publicIp = publicIp;
  const turnCert = flagVal('turn-cert') || cfg.deploy.turnCertFile || '';
  const turnKey = flagVal('turn-key') || cfg.deploy.turnKeyFile || '';
  cfg.deploy.turnCertFile = turnCert;
  cfg.deploy.turnKeyFile = turnKey;

  fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2) + '\n');

  if (!certCovers(allIps, domain)) {
    const cn = makeCert(allIps, domain);
    log('Сертификат создан заново (CN=' + cn + ', адреса: ' + allIps.join(', ') + ')');
  } else {
    log('Сертификат актуален, пересоздание не требуется');
  }

  writeLivekitYaml(cfg);

  const hasBin = fs.existsSync(LK_BIN);
  const addr = domain || primary || 'localhost';
  console.log('');
  log('Готово. Конфигурация:');
  console.log('   Адрес для входа:  https://' + addr + ':' + cfg.port);
  if (!domain) console.log('   (в локальной сети используйте один из адресов: ' + allIps.join(', ') + ')');
  console.log('   Пароль комнаты:   ' + cfg.roomPassword);
  console.log('   Комнат:           любые по названию, до ' + cfg.maxParticipants + ' человек');
  console.log('   Медиа-порты:      UDP ' + cfg.livekit.udpRange + ', TCP ' + cfg.livekit.tcpPort + ' (сигналинг идёт через ' + cfg.port + ')');
  console.log('   LiveKit-сервер:   ' + (hasBin ? 'найден (' + path.basename(LK_BIN) + ')' : 'НЕ НАЙДЕН — положите livekit-server в папку livekit/'));
  console.log('');
  log('Дальше: .\\start.ps1  (поднимет LiveKit и веб-сервер)');
}

main();
