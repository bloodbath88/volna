/** Проверка окна Electron через DevTools: вошло ли приложение в комнату. */
const PORT = Number(process.env.CDP_PORT || 9223);

const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.log('окно не найдено');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
const result = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ error: 'таймаут' }), 8000);
  ws.onopen = () => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: `(() => ({
          url: location.href,
          room: !(document.querySelector('#roomScreen') || {}).classList.contains('hidden'),
          title: (document.querySelector('#roomTitle') || {}).textContent || '',
          people: document.querySelectorAll('#people .person').length,
          tiles: document.querySelectorAll('#grid .tile').length,
          ping: (document.querySelector('#pingBadge') || {}).textContent || '',
        }))()`,
        returnByValue: true,
      },
    }));
  };
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id === 1) {
      clearTimeout(timer);
      resolve(data.result && data.result.result ? data.result.result.value : { error: 'нет ответа' });
    }
  };
  ws.onerror = () => { clearTimeout(timer); resolve({ error: 'ws' }); };
});

console.log(JSON.stringify(result, null, 2));
ws.close();
