// Снимок окна настольного приложения через CDP.
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || '9223';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /volna/i.test(t.url || ''));
if (!page) { console.log('страница не найдена'); process.exit(0); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
await new Promise((res) => ws.addEventListener('open', res));
const send = (method, params = {}) => new Promise((res) => {
  const myId = ++id;
  pending.set(myId, res);
  ws.send(JSON.stringify({ id: myId, method, params }));
});

const shot = await send('Page.captureScreenshot', { format: 'png' });
const file = 'shot-desktop-' + Date.now() + '.png';
writeFileSync(file, Buffer.from(shot.data, 'base64'));
console.log(file);
ws.close();
