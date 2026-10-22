// Проверяет раскладку в настольном приложении: правая колонка с друзьями.
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

const expr = `(() => {
  const side = document.querySelector('.side');
  const box = document.querySelector('#friendsBox');
  const chat = document.querySelector('#chatPanel');
  const rect = (el) => el ? el.getBoundingClientRect() : null;
  const s = rect(side);
  return {
    width: window.innerWidth,
    hasSide: !!side,
    friendsInSide: !!(side && box && side.contains(box)),
    sideWidth: s ? Math.round(s.width) : 0,
    sideTop: s ? Math.round(s.top) : 0,
    chatBottom: chat ? Math.round(rect(chat).bottom) : 0,
    name: document.querySelector('#nameInput') ? document.querySelector('#nameInput').value : null,
    user: document.querySelector('#chanUser') ? document.querySelector('#chanUser').textContent : null,
  };
})()`;

const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
console.log(JSON.stringify(res.result && res.result.result && res.result.result.value, null, 2));
ws.close();
