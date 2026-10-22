// Смотрит состояние окна настольного приложения «Волна» через CDP.
const PORT = process.env.CDP_PORT || '9223';

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && /volna|localhost|127\.0\.0\.1/i.test(t.url || ''));
  if (!page) {
    console.log('страница не найдена', list.map((t) => t.url));
    return;
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  await new Promise((res) => ws.addEventListener('open', res));
  const send = (method, params = {}) => new Promise((res) => {
    const myId = ++id;
    pending.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });

  const expr = `(() => {
    const box = document.querySelector('#authScreen');
    const name = document.querySelector('#nameInput');
    const scripts = Array.from(document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src'));
    return {
      url: location.href,
      authScreen: !!box,
      rememberBox: !!document.querySelector('#authRemember'),
      name: name ? name.value : null,
      joinVisible: !!document.querySelector('#joinScreen') && !document.querySelector('#joinScreen').classList.contains('hidden'),
      scripts: scripts,
      hasInviteCheckbox: !!document.querySelector('#autoJoin'),
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(JSON.stringify(res.result && res.result.result && res.result.result.value, null, 2));
  ws.close();
}

main().catch((e) => {
  console.error('ОШИБКА', e.message);
  process.exitCode = 1;
});
