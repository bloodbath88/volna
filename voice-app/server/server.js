/**
 * «Волна» — веб-сервер.
 *  - отдаёт интерфейс по HTTPS
 *  - выдаёт токены доступа к комнатам (после проверки пароля)
 *  - проксирует WebSocket-сигналинг LiveKit на локальный порт (чтобы браузеру хватало одного TLS-порта)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const httpProxy = require('http-proxy');
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');

const ROOT = path.join(__dirname, '..');
const CFG_PATH = path.join(ROOT, 'config.json');
const CERT_CRT = path.join(ROOT, 'certs', 'server.crt');
const CERT_KEY = path.join(ROOT, 'certs', 'server.key');

if (!fs.existsSync(CFG_PATH) || !fs.existsSync(CERT_CRT) || !fs.existsSync(CERT_KEY)) {
  console.error('Нет конфигурации или сертификата. Сначала выполните: node server/setup.js');
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
const lk = cfg.livekit || {};
const LK_PORT = lk.port || 7880;
const PORT = cfg.port || 8443;

const app = express();
app.disable('x-powered-by');

/* ---------- 1. Прозрачный прокси сигналинга LiveKit (/rtc, /rtc/validate) ---------- */

const proxy = httpProxy.createProxyServer({
  target: 'ws://127.0.0.1:' + LK_PORT,
  ws: true,
  changeOrigin: true,
  xfwd: true,
});

proxy.on('error', (err, req, res) => {
  try {
    if (res && res.writeHead && !res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      if (res.end) res.end('LiveKit недоступен: ' + (err && err.message ? err.message : 'ошибка'));
    } else if (res && res.destroy) {
      res.destroy();
    }
  } catch (_) { /* ничего не поделать */ }
});

app.use((req, res, next) => {
  if (req.url.startsWith('/rtc')) return proxy.web(req, res);
  next();
});

/* ---------- 2. API ---------- */

app.use(express.json({ limit: '16kb' }));

const roomClient = new RoomServiceClient('http://127.0.0.1:' + LK_PORT, lk.apiKey, lk.apiSecret);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/config', (req, res) => {
  res.json({
    serverName: cfg.serverName || 'Волна',
    passwordRequired: Boolean(cfg.roomPassword),
    maxParticipants: cfg.maxParticipants || 25,
  });
});

app.get('/api/rooms', async (req, res) => {
  try {
    const rooms = await roomClient.listRooms();
    res.json({
      rooms: rooms
        .map((r) => ({ name: r.name, participants: r.numParticipants }))
        .filter((r) => r.name)
        .sort((a, b) => b.participants - a.participants)
        .slice(0, 12),
    });
  } catch (e) {
    res.json({ rooms: [] });
  }
});

/* ---------- 3. Выдача токена ---------- */

const attempts = new Map(); // ip -> [времена попыток]

function rateLimited(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now);
  attempts.set(ip, list);
  if (attempts.size > 500) attempts.clear();
  return list.length > 20;
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function cleanName(raw) {
  const s = String(raw || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 32);
  return s || 'Гость';
}

function cleanRoom(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё._-]/gi, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return s || 'main';
}

app.post('/api/token', async (req, res) => {
  const ip = req.socket.remoteAddress || '?';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Слишком много попыток входа. Подождите минуту.' });
  }

  const body = req.body || {};
  if (cfg.roomPassword && !safeEqual(body.password || '', cfg.roomPassword)) {
    return res.status(403).json({ error: 'Неверный пароль комнаты' });
  }

  const name = cleanName(body.name);
  const room = cleanRoom(body.room);

  try {
    const at = new AccessToken(lk.apiKey, lk.apiSecret, {
      identity: 'u-' + crypto.randomUUID(),
      name,
      ttl: '12h',
    });
    at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    const token = await at.toJwt();
    res.json({ token, url: 'wss://' + req.headers.host, room });
  } catch (e) {
    console.error('Ошибка выдачи токена:', e.message);
    res.status(500).json({ error: 'Не удалось создать токен' });
  }
});

/* ---------- 4. Статика ---------- */

app.use(
  express.static(path.join(ROOT, 'public'), {
    etag: true,
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

/* ---------- 5. Запуск ---------- */

const server = https.createServer(
  { key: fs.readFileSync(CERT_KEY), cert: fs.readFileSync(CERT_CRT) },
  app
);

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/rtc')) {
    proxy.ws(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('\nПорт ' + PORT + ' уже занят — возможно, сервер уже запущен.');
  } else {
    console.error('\nОшибка сервера: ' + err.message);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = (cfg.deploy && cfg.deploy.lanIps) || [];
  console.log('');
  console.log('  ' + (cfg.serverName || 'Волна') + ' — голосовая связь');
  console.log('  ------------------------------------------');
  console.log('  Откройте в браузере:');
  console.log('    https://localhost:' + PORT + '  (этот компьютер)');
  for (const ip of ips) console.log('    https://' + ip + ':' + PORT);
  if (cfg.roomPassword) console.log('\n  Пароль комнаты: ' + cfg.roomPassword);
  console.log('\n  Ctrl+C — остановить');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\nОстановка…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
});
