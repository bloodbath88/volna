/**
 * «Волна» — HTTP→HTTPS переадресация на домен.
 *
 * Нужна, чтобы `http://volna.is-cool.dev` (и просто адрес без схемы, который браузер
 * открывает по http) попадал на защищённую версию, а не висел в таймауте.
 *
 * Запуск: DOMAIN=volna.is-cool.dev PORT=80 node server/redirect.js
 */
const http = require('http');

const PORT = Number(process.env.PORT || 80);
const DOMAIN = String(process.env.DOMAIN || 'volna.is-cool.dev').trim();

const server = http.createServer((req, res) => {
  const path = req.url && req.url.startsWith('/') ? req.url : '/';
  const target = 'https://' + DOMAIN + path;
  res.writeHead(301, { Location: target, 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(target + '\n');
});

server.on('error', (err) => {
  console.error('переадресация не запустилась:', err.message);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('переадресация http://*:' + PORT + ' -> https://' + DOMAIN);
});
