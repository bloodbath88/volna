/**
 * Проверка настольного приложения «Волна» (Electron): подключается к окну по
 * DevTools-Protocol и смотрит, что реально отрисовано.
 *
 * Запуск: node tools/electron-check.mjs [--port=9222]
 */
const args = process.argv.slice(2);
const PORT = Number((args.find((a) => a.startsWith('--port=')) || '').slice(7)) || 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return await r.json();
}

async function main() {
  let list = [];
  for (let i = 0; i < 30; i++) {
    try {
      list = await targets();
      if (list.some((t) => t.type === 'page')) break;
    } catch (e) { /* окно ещё поднимается */ }
    await sleep(1000);
  }
  const page = list.find((t) => t.type === 'page');
  if (!page) { console.log('ИТОГ: окно приложения не найдено'); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const myId = ++id;
    pending.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return { error: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : null;
  };

  await send('Runtime.enable');
  await sleep(2500);

  const info = await evaluate(`(() => {
    const q = (s) => document.querySelector(s);
    const vis = (s) => { const n = q(s); return !!n && !n.classList.contains('hidden'); };
    return {
      url: location.href,
      title: document.title,
      secure: window.isSecureContext,
      joinVisible: vis('#joinScreen'),
      roomVisible: vis('#roomScreen'),
      roomTitle: (q('#roomTitle') || {}).textContent || '',
      people: Array.from(document.querySelectorAll('#people .p-name')).map((n) => n.textContent),
      hasChatBtn: !!q('#chatBtn'),
      hasMenu: !!q('#settings'),
      hasGameSelect: !!q('#gameQuality'),
      hasFriendList: !!q('#friendList'),
      nsOn: !!(q('#nsToggle') && q('#nsToggle').checked),
      debug: !!window.__volnaDebug,
      version: window.__volnaDebug ? window.__volnaDebug.version : 0,
      debugInRoom: window.__volnaDebug ? window.__volnaDebug.inRoom() : null,
      debugRoom: window.__volnaDebug ? window.__volnaDebug.currentRoom() : '',
      hasLiveRoom: !!(window.__volnaDebug && window.__volnaDebug.room && window.__volnaDebug.room()),
      hint: (q('#joinHint') || {}).textContent || '',
      toasts: Array.from(document.querySelectorAll('#toasts .toast')).map((t) => t.textContent),
      joinDisabled: !!(q('#joinBtn') && q('#joinBtn').disabled),
      connDot: (q('#connDot') || {}).className || '',
      storage: {
        auto: localStorage.getItem('volna.auto'),
        invite: (localStorage.getItem('volna.invite') || '').slice(0, 24),
        rooms: localStorage.getItem('volna.rooms'),
        friends: localStorage.getItem('volna.friends'),
      },
      roomsCount: document.documentElement.dataset.volnaRooms || '',
      leaveBtn: (() => {
        const b = q('#leaveBtn');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { visible: r.width > 0 && r.height > 0, size: Math.round(r.width) + 'x' + Math.round(r.height), title: b.title, filledIcon: !!b.querySelector('path[fill]') };
      })(),
    };
  })()`);

  console.log('Окно приложения:');
  console.log(JSON.stringify(info, null, 2));
  const ok = info && info.roomVisible && info.people.some((p) => /Admin/.test(p)) && info.hasChatBtn &&
    info.hasGameSelect && info.hasFriendList && info.debug;

  // Дополнительно: демонстрация экрана (игровой профиль) — только по ключу --share
  let shareOk = true;
  if (args.includes('--share')) {
    await evaluate(`(() => {
      const sel = document.querySelector('#gameQuality');
      if (sel) { sel.value = 'qhd60'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      return true;
    })()`);
    await evaluate("(() => { document.querySelector('#screenBtn').click(); return true; })()");
    await sleep(7000);
    const share = await evaluate(`(() => {
      const q = (s) => document.querySelector(s);
      const d = window.__volnaDebug;
      const room = d && d.room();
      const lp = room && room.localParticipant;
      let pub = null;
      if (lp && lp.getTrackPublication) {
        pub = lp.getTrackPublication('screen_share') || lp.getTrackPublication('screenShare') ||
          Array.from(lp.trackPublications.values()).find((p) => String(p.source).indexOf('screen') >= 0);
      }
      const mst = pub && pub.track && pub.track.mediaStreamTrack ? pub.track.mediaStreamTrack : null;
      const st = mst ? mst.getSettings() : null;
      return {
        profile: d && d.lastScreenProfile ? d.lastScreenProfile() : '',
        hasPub: !!pub,
        muted: pub ? pub.isMuted : null,
        width: st ? st.width : 0,
        height: st ? st.height : 0,
        frameRate: st ? st.frameRate : 0,
        contentHint: mst ? (mst.contentHint || '') : '',
        degradation: pub && pub.track ? String(pub.track.degradationPreference || '') : '',
        shareBtnActive: !!(q('#screenBtn') && q('#screenBtn').classList.contains('is-active')),
      };
    })()`);
    console.log('');
    console.log('Демонстрация экрана:');
    console.log(JSON.stringify(share, null, 2));
    shareOk = !!(share && share.profile && share.profile.indexOf('1440') >= 0 && share.hasPub &&
      share.contentHint === 'motion' && share.frameRate >= 24);
  }

  console.log('');
  console.log('ИТОГ electron-check: ' + (ok && shareOk ? 'OK' : 'ПРОВАЛ'));
  ws.close();
  process.exit(ok && shareOk ? 0 : 1);
}

main().catch((e) => { console.log('ошибка: ' + (e && e.message)); console.log('ИТОГ electron-check: ПРОВАЛ'); process.exit(1); });
