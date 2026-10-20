/**
 * Локальное HTTP-зеркало «Волны» для проверки интерфейса.
 *
 * Зачем: антивирус подменяет сертификат, и Chrome отказывается открывать https://localhost:8443.
 * Это зеркало отдаёт те же файлы по http://127.0.0.1:8080 и проксирует /api/* в настоящий сервер.
 *
 * Запуск: node tools/http-preview.mjs   (нужен работающий сервер «Волны» на 8443)
 */
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = join(process.cwd(), 'voice-app', 'public');
const PORT = Number(process.env.VOLNA_PREVIEW_PORT || 8080);
const UPSTREAM = { host: '127.0.0.1', port: 8443 };

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  if (url.startsWith('/api/')) {
    const chunks = [];
    const proxied = https.request(
      { ...UPSTREAM, path: url, method: req.method, rejectUnauthorized: false, headers: req.headers },
      (up) => {
        up.on('data', (chunk) => chunks.push(chunk));
        up.on('end', () => {
          let body = Buffer.concat(chunks).toString('utf-8');
          // для http-превью сигналинг должен идти по ws://, а не wss://
          if (url.startsWith('/api/token')) body = body.replace(/"wss:\/\//g, '"ws://');
          const headers = { ...up.headers };
          headers['content-length'] = Buffer.byteLength(body);
          res.writeHead(up.statusCode || 502, headers);
          res.end(body);
        });
      }
    );
    proxied.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end('{"error":"upstream"}');
    });
    req.pipe(proxied);
    return;
  }

  const clean = normalize(decodeURIComponent(url.split('?')[0])).replace(/^([/\\])+/, '');
  const file = join(ROOT, clean === '' ? 'index.html' : clean);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});

server.on('upgrade', (req, socket, head) => {
  // WebSocket (сигналинг LiveKit) проксируем «как есть» через TLS-туннель
  const up = tls.connect({ host: UPSTREAM.host, port: UPSTREAM.port, rejectUnauthorized: false }, () => {
    let raw = req.method + ' ' + req.url + ' HTTP/1.1\r\n';
    Object.keys(req.headers).forEach((k) => { raw += k + ': ' + req.headers[k] + '\r\n'; });
    raw += '\r\n';
    up.write(raw);
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', () => { try { socket.destroy(); } catch (e) { /* уже закрыт */ } });
  socket.on('error', () => { try { up.destroy(); } catch (e) { /* уже закрыт */ } });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('превью: http://127.0.0.1:' + PORT);
});
