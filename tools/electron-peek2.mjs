// Проверяет, что именно приложение исполняет: размеры ресурсов и свежесть entry.js.
const PORT = process.env.CDP_PORT || '9223';

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && /volna/i.test(t.url || ''));
  if (!page) { console.log('страница не найдена'); return; }

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

  const expr = `(async () => {
    const res = performance.getEntriesByType('resource').filter((r) => /entry\\.js/.test(r.name));
    const info = res.map((r) => ({ name: r.name, transfer: r.transferSize, decoded: r.decodedBodySize, dur: Math.round(r.duration) }));
    let fresh = null;
    try {
      const text = await fetch('entry.js?v=20261022d&probe=' + Date.now(), { cache: 'no-store' }).then((r) => r.text());
      fresh = { len: text.length, auth: text.includes('authRemember'), side: text.includes("querySelector('.side')") };
    } catch (e) { fresh = { err: String(e && e.message) }; }
    return { info, fresh, scripts: Array.from(document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src')) };
  })()`;

  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(res.result && res.result.result && res.result.result.value, null, 2));
  ws.close();
}

main().catch((e) => { console.error('ОШИБКА', e.message); process.exitCode = 1; });
