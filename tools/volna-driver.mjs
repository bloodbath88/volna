/**
 * Тестовый драйвер «Волны»: запускает Chrome (headless), открывает приложение
 * и выполняет сценарии через Chrome DevTools Protocol. Только для проверок в проекте.
 *
 * Запуск: node tools/volna-driver.mjs <сценарий> [--mic] [--url=<адрес>]
 *   сценарии: join | rejoin | rapid | nomic | keepalive
 *   --mic      включить эмуляцию микрофона (иначе устройств нет)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const scenario = args.find((a) => !a.startsWith('--')) || 'join';
const withMic = args.includes('--mic');
const urlArg = (args.find((a) => a.startsWith('--url=')) || '').slice(6);
const BASE = urlArg || 'https://localhost:8443';
const DEBUG_PORT = Number((args.find((a) => a.startsWith('--port=')) || '').slice(7)) || (9300 + Math.floor(Math.random() * 90));

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => p && existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = { scenario, steps: [], ok: null, errors: [] };
function step(name, data) {
  report.steps.push({ name, ...(data === undefined ? {} : { data }) });
  console.log('  · ' + name + (data === undefined ? '' : ' → ' + JSON.stringify(data)));
}

function chromeFlags(profileDir, port) {
  const f = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--ignore-certificate-errors',
    '--allow-insecure-localhost',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,BackForwardCache',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    'about:blank',
  ];
  if (withMic) {
    f.splice(1, 0, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream');
  }
  if (scenario === 'screenshare') {
    // захват экрана без диалогового окна — для автотеста демонстрации
    f.splice(1, 0,
      '--enable-usermedia-screen-capturing',
      '--auto-select-desktop-capture-source=Entire screen',
      '--use-fake-ui-for-media-stream',
      '--allow-http-screen-capture'
    );
  }
  return f;
}

async function waitForDevtools(port, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch { /* ещё не поднялся */ }
    await sleep(200);
  }
  throw new Error('DevTools не отвечает на порту ' + port);
}

async function newPage(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  if (!r.ok) throw new Error('не удалось создать вкладку: ' + r.status);
  return await r.json();
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    const cdp = new Cdp(ws);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws error')); });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        cdp.events.push(msg);
      }
    };
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('таймаут CDP: ' + method)); }
      }, 30000);
    });
  }
  async eval(expression, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise, returnByValue: true, allowUnsafeEvalBlockedByCSP: true,
    });
    if (r.exceptionDetails) {
      throw new Error('ошибка в странице: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch { /* уже закрыт */ } }
}

/* ---------- снимок состояния страницы (только по DOM) ---------- */
const SNAPSHOT = `(() => {
  const q = (s) => document.querySelector(s);
  const vis = (s) => { const n = q(s); return !!n && !n.classList.contains('hidden'); };
  return {
    joinVisible: vis('#joinScreen'),
    roomVisible: vis('#roomScreen'),
    joinHint: (q('#joinHint') || {}).textContent || '',
    connText: (q('#connText') || {}).textContent || '',
    connDot: (q('#connDot') || {}).className || '',
    roomTitle: (q('#roomTitle') || {}).textContent || '',
    people: document.querySelectorAll('#people .person').length,
    tiles: document.querySelectorAll('#grid .tile').length,
    toasts: Array.from(document.querySelectorAll('#toasts .toast')).map((t) => t.textContent),
    audioEls: document.querySelectorAll('#remoteAudio audio').length,
    micOff: (q('#micBtn') || { classList: { contains: () => false } }).classList.contains('is-off'),
    banner: vis('#audioBanner'),
    micWarn: vis('#micWarn'),
    inviteBanner: vis('#inviteBanner'),
    inviteSub: (q('#inviteSub') || {}).textContent || '',
    passHidden: !!q('#passField') && q('#passField').classList.contains('hidden'),
    roomInput: (q('#roomInput') || {}).value || '',
    joinBtnDisabled: !!q('#joinBtn') && q('#joinBtn').disabled,
    joinBtnText: q('#joinBtn') ? q('#joinBtn').textContent : '',
    hintVisible: !!q('#browserHint') && !!q('#browserHint').textContent,
  };
})()`;

const setJoinFields = (name, pass, room) => `(() => {
  const d = (n, v) => { const e = document.querySelector(n); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
  d('#nameInput', ${JSON.stringify(name)});
  ${room ? `d('#roomInput', ${JSON.stringify(room)});` : ''}
  ${pass === null ? '' : `d('#passInput', ${JSON.stringify(pass)});`}
  return true;
})()`;

const INSTRUMENT = `(() => {
  const LK = window.LivekitClient;
  window.__probe = { connect: 'not-called', mic: 'not-called', gum: [], gumErr: null, gumStack: '', notes: [] };
  const patch = (obj, name, tag) => {
    try {
      const d = Object.getOwnPropertyDescriptor(obj, name);
      window.__probe.notes.push(tag + ': writable=' + (d && d.writable) + ', configurable=' + (d && d.configurable) + ', valueType=' + (d && typeof d.value));
      if (!d || typeof d.value !== 'function') return;
      const orig = d.value;
      Object.defineProperty(obj, name, {
        ...d,
        value: function (...a) {
          window.__probe[tag] = 'started';
          const p = orig.apply(this, a);
          if (p && typeof p.then === 'function') {
            return p.then((r) => { window.__probe[tag] = 'ok'; return r; }, (e) => { window.__probe[tag] = 'error: ' + (e && e.message); throw e; });
          }
          window.__probe[tag] = 'ok';
          return p;
        },
      });
    } catch (e) {
      window.__probe.notes.push(tag + ': патч не удался — ' + e.message);
    }
  };
  if (LK && LK.Room) patch(LK.Room.prototype, 'connect', 'connect');
  if (LK && LK.LocalParticipant) patch(LK.LocalParticipant.prototype, 'setMicrophoneEnabled', 'mic');
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const og = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (c) {
      const st = (new Error('gum')).stack || '';
      window.__probe.gum.push(JSON.stringify(c));
      window.__probe.gumStack = st.split('\\n').slice(0, 9).join(' | ');
      return og(c).catch((e) => { window.__probe.gumErr = (e && e.name) + ': ' + (e && e.message); throw e; });
    };
  }
  window.__probeState = () => JSON.stringify(window.__probe);
  return true;
})()`;

const clickJoin = `(() => { document.querySelector('#joinBtn').click(); return true; })()`;
const clickLeave = `(() => { document.querySelector('#leaveBtn').click(); return true; })()`;

async function waitFor(cdp, fn, timeoutMs = 20000, every = 300) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await cdp.eval(SNAPSHOT, false);
    if (fn(last)) return last;
    await sleep(every);
  }
  return last;
}

const inRoom = (s) => s.roomVisible && s.connText === '';

async function main() {
  if (!CHROME) throw new Error('не найден Chrome или Edge');
  const profile = mkdtempSync(join(tmpdir(), 'volna-prof-'));
  const chrome = spawn(CHROME, chromeFlags(profile, DEBUG_PORT), { stdio: 'ignore' });
  let cdp = null;
  try {
    await waitForDevtools(DEBUG_PORT);
    const page = await newPage(DEBUG_PORT);
    cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    cdp.events = [];

    step('браузер запущен', { chrome: CHROME, mic: withMic, url: BASE });

    // данные для входа
    const room = process.env.VOLNA_ROOM || 'main';
    const pass = process.env.VOLNA_PASS || '';
    const name = process.env.VOLNA_NAME || 'Тест';

    const open = async (query = '') => {
      await cdp.send('Page.navigate', { url: BASE + '/?room=' + encodeURIComponent(room) + query });
      await sleep(1200);
      await cdp.eval(SNAPSHOT, false);
    };
    const fill = () => cdp.eval(setJoinFields(name, pass, room), false);

    if (scenario === 'join') {
      await open();
      step('страница входа открыта', await cdp.eval(SNAPSHOT, false));
      await fill();
      await cdp.eval(clickJoin, false);
      const s = await waitFor(cdp, inRoom, 25000);
      step('после входа', s);
      step('состав комнаты по данным сервера', JSON.parse(await cdp.eval("fetch('/api/rooms').then((r) => r.text())", true)));
      report.ok = inRoom(s);
    }

    if (scenario === 'rejoin') {
      await open();
      for (let i = 1; i <= 3; i++) {
        await fill();
        await cdp.eval(clickJoin, false);
        const s = await waitFor(cdp, (x) => inRoom(x) || (x.joinHint !== '' && x.joinHint !== 'Подключаемся…'), 25000);
        step(`вход №${i}`, { room: s.roomVisible, conn: s.connText, hint: s.joinHint, toasts: s.toasts });
        if (!inRoom(s)) { report.ok = false; report.errors.push('вход №' + i + ' не состоялся: ' + s.joinHint); break; }
        await cdp.eval(clickLeave, false);
        await sleep(1200);
        const s2 = await cdp.eval(SNAPSHOT, false);
        step(`выход №${i}`, { joinVisible: s2.joinVisible, room: s2.roomVisible, toasts: s2.toasts });
        if (!s2.joinVisible || s2.roomVisible) { report.ok = false; report.errors.push('после выхода экран входа не вернулся'); break; }
        if (report.ok === null) report.ok = true;
      }
      // повторный вход после перезагрузки страницы
      if (report.ok !== false) {
        await open();
        await fill();
        await cdp.eval(clickJoin, false);
        const s = await waitFor(cdp, (x) => inRoom(x) || (x.joinHint !== '' && x.joinHint !== 'Подключаемся…'), 25000);
        step('вход после перезагрузки страницы', { room: s.roomVisible, conn: s.connText, hint: s.joinHint });
        if (!inRoom(s)) { report.ok = false; report.errors.push('вход после перезагрузки не состоялся: ' + s.joinHint); }
      }
    }

    if (scenario === 'rapid') {
      await open();
      for (let i = 1; i <= 3; i++) {
        if (i > 1) { await open(); }
        await fill();
        await cdp.eval(clickJoin, false);
        const s = await waitFor(cdp, inRoom, 25000);
        step(`быстрый вход №${i}`, { room: s.roomVisible, conn: s.connText });
        // выходим и сразу же входим снова — без ожидания
        await cdp.eval(clickLeave, false);
        await fill();
        await cdp.eval(clickJoin, false);
        await sleep(2500);
        const s2 = await cdp.eval(SNAPSHOT, false);
        step(`после мгновенного повторного входа №${i}`, s2);
        if (!inRoom(s2)) { report.ok = false; break; }
        report.ok = true;
      }
    }

    if (scenario === 'nomic') {
      await open();
      await cdp.eval(INSTRUMENT, false);
      await fill();
      await cdp.eval(clickJoin, false);
      const s = await waitFor(cdp, (x) => inRoom(x) || (x.joinHint !== '' && x.joinHint !== 'Подключаемся…'), 25000);
      step('вход без микрофона', { room: s.roomVisible, join: s.joinVisible, hint: s.joinHint, btnDisabled: s.joinBtnDisabled, toasts: s.toasts });
      step('проба LiveKit', JSON.parse(await cdp.eval('window.__probeState()', false)));
      step('состав комнаты по данным сервера', JSON.parse(await cdp.eval("fetch('/api/rooms').then((r) => r.text())", true)));
      step('устройство LiveKit в странице', await cdp.eval(`(() => {
        const LK = window.LivekitClient;
        return {
          lib: Object.keys(LK || {}).filter((k) => /room|version|Room/i.test(k)).slice(0, 12),
          version: LK && (LK.version || (LK.default && LK.default.version)),
          connectType: typeof (LK.Room && LK.Room.prototype.connect),
          connectOwn: !!(LK.Room && Object.prototype.hasOwnProperty.call(LK.Room.prototype, 'connect')),
          micType: typeof (LK.LocalParticipant && LK.LocalParticipant.prototype.setMicrophoneEnabled),
          roomProps: LK.Room ? Object.getOwnPropertyNames(LK.Room.prototype).slice(0, 25) : [],
        };
      })()`, false));
      await sleep(1500);
      const s2 = await cdp.eval(SNAPSHOT, false);
      step('предупреждение о микрофоне', { room: s2.roomVisible, micWarn: s2.micWarn, micOff: s2.micOff });
      report.ok = inRoom(s) && s2.micWarn;
    }

    if (scenario === 'invite') {
      const code = Buffer.from(JSON.stringify({ r: room, k: pass }), 'utf8').toString('base64url');
      await cdp.send('Page.navigate', { url: BASE + '/#i=' + code });
      await sleep(1500);
      const s0 = await cdp.eval(SNAPSHOT, false);
      step('ссылка открыта', { inviteBanner: s0.inviteBanner, inviteSub: s0.inviteSub, passHidden: s0.passHidden, room: s0.roomInput });
      const s = await waitFor(cdp, inRoom, 20000, 500);
      step('после авто-подключения', { room: s.roomVisible, conn: s.connText, title: s.roomTitle, people: s.people, hash: await cdp.eval('location.hash', false) });
      const fallback = await cdp.eval(`(() => {
        const field = document.querySelector('#passField');
        const box = document.querySelector('#toasts');
        return {
          passFieldHidden: field ? field.classList.contains('hidden') : null,
          toasts: box ? Array.from(box.children).map((t) => t.textContent).slice(-2) : [],
        };
      })()`, false);
      step('подсказка при неудачном входе по ссылке', fallback);
      report.ok = inRoom(s) || (fallback.passFieldHidden === false && (fallback.toasts || []).some((t) => t.indexOf('обрезалась') >= 0));
    }

    if (scenario === 'invitekeep') {
      // ссылка-приглашение, затем перезапуск окна без параметров — должно подключиться само
      const code = Buffer.from(JSON.stringify({ r: room, k: pass }), 'utf8').toString('base64url');
      await cdp.send('Page.navigate', { url: BASE + '/#i=' + code });
      await sleep(1500);
      const s = await waitFor(cdp, inRoom, 20000, 500);
      step('вход по ссылке', { room: s.roomVisible, title: s.roomTitle });
      if (!inRoom(s)) { report.ok = false; } else {
        await cdp.send('Page.navigate', { url: BASE + '/' });
        await sleep(1500);
        const s2 = await cdp.eval(SNAPSHOT, false);
        step('запуск без параметров', { inviteBanner: s2.inviteBanner, inviteSub: s2.inviteSub, room: s2.roomInput });
        const s3 = await waitFor(cdp, inRoom, 20000, 500);
        step('после авто-подключения', { room: s3.roomVisible, conn: s3.connText, title: s3.roomTitle });
        report.ok = inRoom(s3);
      }
    }

    if (scenario === 'invitecancel') {
      const code = Buffer.from(JSON.stringify({ r: room, k: pass }), 'utf8').toString('base64url');
      await cdp.send('Page.navigate', { url: BASE + '/#i=' + code });
      await sleep(1200);
      await cdp.eval("(() => { document.querySelector('#inviteCancelBtn').click(); return true; })()", false);
      await sleep(4000);
      const s = await cdp.eval(SNAPSHOT, false);
      step('после отмены авто-входа', { room: s.roomVisible, join: s.joinVisible, passHidden: s.passHidden, roomInput: s.roomInput, banner: s.inviteBanner });
      report.ok = s.joinVisible && !s.roomVisible;
    }

    if (scenario === 'micretry') {
      // вход без микрофона, затем кнопкой микрофона пробуем включить снова
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      const s = await waitFor(cdp, (x) => inRoom(x) || (x.joinHint !== '' && x.joinHint !== 'Подключаемся…'), 25000);
      step('вход без микрофона', { room: s.roomVisible, micWarn: s.micWarn, toasts: s.toasts });
      await cdp.eval("(() => { document.querySelector('#micBtn').click(); return true; })()", false);
      await sleep(1500);
      const s2 = await cdp.eval(SNAPSHOT, false);
      step('нажатие микрофона', { room: s2.roomVisible, micWarn: s2.micWarn, toasts: s2.toasts });
      await cdp.eval(clickLeave, false);
      await sleep(1200);
      const s3 = await cdp.eval(SNAPSHOT, false);
      step('выход', { join: s3.joinVisible, room: s3.roomVisible, hint: s3.joinHint, passHidden: s3.passHidden });
      report.ok = inRoom(s) && s3.joinVisible && !s3.roomVisible && s3.joinHint === '';
    }

    if (scenario === 'twowindows') {
      // окно A открыто и ждёт; в окне B открывают ссылку-приглашение — A должен подключиться сам
      await cdp.send('Page.navigate', { url: BASE + '/?room=' + encodeURIComponent(room) });
      await sleep(1200);
      await cdp.eval("(() => { localStorage.clear(); localStorage.setItem('volna.auto','1'); return true; })()", false);
      await cdp.send('Page.navigate', { url: BASE + '/?room=' + encodeURIComponent(room) });
      await sleep(1500);
      step('окно A ждёт', await cdp.eval(SNAPSHOT, false));

      const pageB = await newPage(DEBUG_PORT);
      const cdpB = await Cdp.connect(pageB.webSocketDebuggerUrl);
      await cdpB.send('Runtime.enable');
      const code = Buffer.from(JSON.stringify({ r: room, k: pass }), 'utf8').toString('base64url');
      await cdpB.send('Page.navigate', { url: BASE + '/#i=' + code });
      await sleep(2000);
      step('окно B открыло ссылку', { url: BASE + '/#i=' + code });
      const s = await waitFor(cdp, inRoom, 20000, 500);
      step('окно A после приглашения', { room: s.roomVisible, title: s.roomTitle, inviteBanner: s.inviteBanner, toasts: s.toasts });
      const b = await cdpB.eval(SNAPSHOT, false);
      step('окно B', { room: b.roomVisible, title: b.roomTitle });
      report.ok = inRoom(s);
      cdpB.close();
    }

    if (scenario === 'invitepop') {
      // вход в комнату, затем кнопка «Пригласить» — ссылка должна быть на сетевом адресе
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      const s = await waitFor(cdp, inRoom, 25000);
      if (!inRoom(s)) { report.ok = false; report.errors.push('вход не состоялся'); }
      else {
        await cdp.eval("(() => { document.querySelector('#inviteBtn').click(); return true; })()", false);
        await sleep(600);
        const pop = await cdp.eval(`(() => {
          const box = document.querySelector('#invitePop');
          const ta = document.querySelector('#inviteText');
          const sel = document.querySelector('#inviteAddr');
          return {
            visible: !!box && !box.classList.contains('hidden'),
            text: ta ? ta.value : '',
            addr: sel ? sel.value : '',
            note: (document.querySelector('#inviteNote') || {}).textContent || '',
          };
        })()`, false);
        const link = pop.text.split('#i=')[1] || '';
        let decoded = '';
        try { decoded = Buffer.from(link.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (e) { decoded = ''; }
        step('окно «Пригласить»', { visible: pop.visible, addr: pop.addr, linkStart: pop.text.slice(0, 40), decoded: decoded, note: pop.note.slice(0, 60) });
        report.ok = pop.visible && pop.text.indexOf('/#i=') > 0 && decoded.indexOf('"r":"' + room + '"') >= 0;
      }
    }

    if (scenario === 'narrow') {
      // узкий экран (телефон): баннер приглашения, окно «Пригласить» и настройки должны помещаться
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
      const code = Buffer.from(JSON.stringify({ r: room, k: pass }), 'utf8').toString('base64url');
      await cdp.send('Page.navigate', { url: BASE + '/#i=' + code });
      await sleep(1600);
      const banner = await cdp.eval(`(() => {
        const b = document.querySelector('#inviteBanner');
        const r = b.getBoundingClientRect();
        return { visible: !b.classList.contains('hidden'), left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth, text: (document.querySelector('#inviteTitle') || {}).textContent || '' };
      })()`, false);
      step('баннер приглашения на узком экране', banner);
      const s = await waitFor(cdp, inRoom, 20000, 500);
      await cdp.eval("(() => { document.querySelector('#inviteBtn').click(); return true; })()", false);
      await sleep(700);
      const pop = await cdp.eval(`(() => {
        const b = document.querySelector('#invitePop');
        const r = b.getBoundingClientRect();
        const ta = document.querySelector('#inviteText');
        return { visible: !b.classList.contains('hidden'), left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth, link: ta ? ta.value.slice(0, 34) : '' };
      })()`, false);
      step('окно «Пригласить» на узком экране', pop);
      await cdp.eval("(() => { document.querySelector('#inviteBtn').click(); return true; })()", false);
      await cdp.eval("(() => { document.querySelector('#setBtn').click(); return true; })()", false);
      await sleep(400);
      const set = await cdp.eval(`(() => {
        const b = document.querySelector('#settings');
        const r = b.getBoundingClientRect();
        return {
          visible: !b.classList.contains('hidden'),
          left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth,
          micOptions: document.querySelectorAll('#micSelect2 option').length,
          modeOptions: document.querySelectorAll('#modeSelect2 option').length,
        };
      })()`, false);
      step('настройки на узком экране', set);
      const fits = (x) => x.visible && x.left >= -1 && x.right <= x.vw + 1;
      report.ok = inRoom(s) && fits(banner) && fits(pop) && fits(set) && set.modeOptions >= 3;
    }

    if (scenario === 'doublejoin') {
      // двойное нажатие Enter на полях входа не должно поднимать два подключения
      await open();
      await fill();
      await cdp.eval(`(() => {
        window.__tokenCalls = 0;
        const original = window.fetch;
        window.fetch = function (u, o) {
          if (String(u).indexOf('/api/token') >= 0) window.__tokenCalls++;
          return original.apply(this, arguments);
        };
        return true;
      })()`, false);
      await cdp.eval(`(() => {
        const f = document.querySelector('#passInput');
        const ev = () => new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        f.dispatchEvent(ev());
        setTimeout(() => f.dispatchEvent(ev()), 30);
        return true;
      })()`, false);
      const s = await waitFor(cdp, inRoom, 25000);
      await sleep(2500);
      const snap = await cdp.eval(SNAPSHOT, false);
      const probe = await cdp.eval(`(() => ({
        tokens: window.__tokenCalls,
        rooms: document.documentElement.dataset.volnaRooms,
        people: document.querySelectorAll('#people .person').length,
        tiles: document.querySelectorAll('#grid .tile').length,
      }))()`, false);
      step('после двойного Enter', probe);
      report.ok = inRoom(s) && probe.tokens === 1 && probe.rooms === '1' && probe.people === 1;
    }

    if (scenario === 'urlinvite') {
      // ?room= должен иметь приоритет над сохранённым приглашением
      const savedRoom = 'saved' + room;
      const code = Buffer.from(JSON.stringify({ r: savedRoom, k: pass }), 'utf8').toString('base64url');
      await cdp.send('Page.navigate', { url: BASE + '/?room=' + encodeURIComponent(room) });
      await sleep(1200);
      await cdp.eval(`(() => {
        localStorage.clear();
        localStorage.setItem('volna.auto', '1');
        localStorage.setItem('volna.invite', ${JSON.stringify(code)});
        return true;
      })()`, false);
      await cdp.send('Page.navigate', { url: BASE + '/?room=' + encodeURIComponent(room) });
      await sleep(4500);
      const s = await cdp.eval(SNAPSHOT, false);
      step('открыт ?room= при сохранённом приглашении', { roomInput: s.roomInput, joinVisible: s.joinVisible, roomVisible: s.roomVisible, banner: s.inviteBanner });
      const urlWins = s.joinVisible && !s.roomVisible && s.roomInput === room && !s.inviteBanner;
      await cdp.send('Page.navigate', { url: BASE + '/' });
      await sleep(1500);
      const b = await cdp.eval(SNAPSHOT, false);
      step('запуск без параметров', { roomInput: b.roomInput, banner: b.inviteBanner });
      const s2 = await waitFor(cdp, inRoom, 20000, 500);
      step('после автозапуска', { room: s2.roomVisible, title: s2.roomTitle, expected: savedRoom });
      report.ok = urlWins && inRoom(s2) && s2.roomTitle === savedRoom;
    }

    if (scenario === 'host') {
      // на машине с сервером имя по умолчанию — Admin
      await open();
      const injected = await cdp.eval(`(() => {
        document.querySelector('#passInput').value = ${JSON.stringify(pass)};
        document.querySelector('#roomInput').value = ${JSON.stringify(room)};
        return (document.querySelector('#nameInput').value || '');
      })()`, false);
      step('имя до входа', { name: injected });
      await cdp.eval(clickJoin, false);
      const s = await waitFor(cdp, inRoom, 25000);
      await sleep(800);
      const first = await cdp.eval("(() => { const r = document.querySelector('#people .p-name'); return r ? r.textContent : ''; })()", false);
      step('имя в комнате', { room: s.roomVisible, first: first });
      report.ok = inRoom(s) && /Admin/.test(first);
    }

    if (scenario === 'menu') {
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      const s = await waitFor(cdp, inRoom, 25000);
      await cdp.eval("(() => { document.querySelector('#setBtn').click(); return true; })()", false);
      await sleep(1000);
      const menu = await cdp.eval(`(() => {
        const box = document.querySelector('#settings');
        const r = box.getBoundingClientRect();
        return {
          visible: !box.classList.contains('hidden'),
          fits: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1,
          ns: !!document.querySelector('#nsToggle'),
          rooms: document.querySelectorAll('#roomList .room-row').length,
          hasCreate: !!document.querySelector('#newRoomBtn'),
          hasChat: !!document.querySelector('#chatToggle'),
          title: (document.querySelector('#setBtn') || {}).title || '',
          modeOptions: document.querySelectorAll('#modeSelect2 option').length,
        };
      })()`, false);
      step('главное меню во время звонка', menu);
      await cdp.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))", false);
      await sleep(300);
      const closed = await cdp.eval("(() => document.querySelector('#settings').classList.contains('hidden'))()", false);
      step('Escape закрывает меню', { closed: closed });
      report.ok = inRoom(s) && menu.visible && menu.fits && menu.ns && menu.hasCreate && menu.hasChat && menu.modeOptions >= 3 && closed;
    }

    if (scenario === 'noise') {
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      const s = await waitFor(cdp, inRoom, 25000);
      await sleep(2500);
      const a = await cdp.eval('window.__volnaDebug.ns()', false);
      await cdp.eval("(() => { const t = document.querySelector('#nsToggle'); t.checked = false; t.dispatchEvent(new Event('change', { bubbles: true })); return true; })()", false);
      await sleep(1400);
      const b = await cdp.eval('window.__volnaDebug.ns()', false);
      await sleep(1500);
      const c = await cdp.eval('window.__volnaDebug.ns()', false);
      step('шумоподавление', { вкл: a.on, кадровПослеВхода: a.frames, послеВыключения: b, черезПолторыСекунды: c });
      report.ok = inRoom(s) && a.on === true && a.frames > 10 && b.on === false && c.frames === b.frames;
    }

    if (scenario === 'rooms') {
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      const s = await waitFor(cdp, inRoom, 25000);
      const newName = 'room' + Math.floor(Math.random() * 900 + 100);
      await cdp.eval("(() => { document.querySelector('#setBtn').click(); return true; })()", false);
      await sleep(900);
      await cdp.eval(`(() => {
        const i = document.querySelector('#newRoomInput');
        i.value = ${JSON.stringify(newName)};
        document.querySelector('#newRoomBtn').click();
        return true;
      })()`, false);
      const s2 = await waitFor(cdp, (x) => x.roomVisible && x.roomTitle === newName, 30000, 400);
      const books = await cdp.eval('window.__volnaDebug.rooms().books', false);
      await cdp.eval("(() => { document.querySelector('#setBtn').click(); return true; })()", false);
      await sleep(900);
      const rows = await cdp.eval("document.querySelectorAll('#roomList .room-row').length", false);
      const current = await cdp.eval("(() => { const r = document.querySelector('#roomList .room-row.current'); return r ? r.textContent : ''; })()", false);
      step('создание комнаты и переход', { был: s.roomTitle, стал: s2.roomTitle, мои: books, строк: rows, текущая: current });
      report.ok = inRoom(s) && s2.roomTitle === newName && books.indexOf(newName) >= 0 && rows >= 1 && current.indexOf(newName) >= 0;
    }

    if (scenario === 'chat') {
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      const s = await waitFor(cdp, inRoom, 25000);
      if (!inRoom(s)) { report.ok = false; report.errors.push('первое окно не вошло'); }
      else {
        const pageB = await newPage(DEBUG_PORT);
        const cdpB = await Cdp.connect(pageB.webSocketDebuggerUrl);
        await cdpB.send('Runtime.enable');
        await cdpB.send('Page.navigate', { url: BASE + '/?room=' + encodeURIComponent(room) });
        await sleep(1500);
        await cdpB.eval(setJoinFields('Собеседник', pass, room), false);
        await cdpB.eval(clickJoin, false);
        const sb = await waitFor(cdpB, inRoom, 25000);
        step('второе окно в комнате', { room: sb.roomVisible, title: sb.roomTitle, people: sb.people });
        await cdp.eval("(() => { document.querySelector('#chatBtn').click(); return true; })()", false);
        await cdpB.eval("(() => { document.querySelector('#chatBtn').click(); return true; })()", false);
        await sleep(500);
        const msg1 = 'привет-' + Math.floor(Math.random() * 1000);
        const msg2 = 'ответ-' + Math.floor(Math.random() * 1000);
        await cdp.eval(`(() => { window.__volnaDebug.sendChat(${JSON.stringify(msg1)}); return true; })()`, false);
        await sleep(1600);
        const bLog = await cdpB.eval("document.querySelector('#chatLog').textContent", false);
        await cdpB.eval(`(() => { window.__volnaDebug.sendChat(${JSON.stringify(msg2)}); return true; })()`, false);
        await sleep(1600);
        const aLog = await cdp.eval("document.querySelector('#chatLog').textContent", false);
        step('сообщения дошли', { первому: aLog.indexOf(msg2) >= 0, второму: bLog.indexOf(msg1) >= 0, логВторого: bLog.slice(0, 90) });
        await cdp.eval("(() => { document.querySelector('#chatCloseBtn').click(); return true; })()", false);
        await sleep(300);
        const msg3 = 'третье-' + Math.floor(Math.random() * 1000);
        await cdpB.eval(`(() => { window.__volnaDebug.sendChat(${JSON.stringify(msg3)}); return true; })()`, false);
        await sleep(1600);
        const badge = await cdp.eval("(() => { const b = document.querySelector('#chatBadge'); return { hidden: b.classList.contains('hidden'), text: b.textContent }; })()", false);
        step('непрочитанное сообщение', badge);
        report.ok = inRoom(s) && inRoom(sb) && bLog.indexOf(msg1) >= 0 && aLog.indexOf(msg2) >= 0 && badge.hidden === false && Number(badge.text) >= 1;
        cdpB.close();
      }
    }

    if (scenario === 'noisediag') {
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      const s = await waitFor(cdp, inRoom, 25000);
      await sleep(2500);
      const info = await cdp.eval(`(() => {
        const d = window.__volnaDebug;
        const room = d && d.room && d.room();
        const lp = room && room.localParticipant;
        const pub = lp && lp.getTrackPublication && lp.getTrackPublication('microphone');
        const track = pub && pub.track;
        return {
          ns: d ? d.ns() : null,
          lastMicError: d && d.lastMicError ? d.lastMicError() : '',
          micWarn: !!document.querySelector('#micWarn') && !document.querySelector('#micWarn').classList.contains('hidden'),
          toasts: Array.from(document.querySelectorAll('#toasts .toast')).map((t) => t.textContent),
          hasRoom: !!room,
          hasPub: !!pub,
          pubMuted: pub ? pub.isMuted : null,
          trackProcessor: track && track.processor ? String(track.processor.name || 'есть') : 'нет',
          trackHasAudioContext: track ? !!track.audioContext : null,
          trackLabel: track && track.mediaStreamTrack ? (track.mediaStreamTrack.label || 'без метки') : '',
          micOff: document.querySelector('#micBtn').classList.contains('is-off'),
        };
      })()`, false);
      step('диагностика шумоподавления', info);
      report.ok = inRoom(s) && !!info.trackProcessor && info.trackProcessor !== 'нет' && info.ns && info.ns.frames > 0;
    }

    if (scenario === 'friends') {
      // Окно A: в комнате. Окно B: тот же аккаунт-Аня» — её и добавим в друзья
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      const s = await waitFor(cdp, inRoom, 25000);
      const roomA = s.roomTitle;

      const pageB = await newPage(DEBUG_PORT);
      const cdpB = await Cdp.connect(pageB.webSocketDebuggerUrl);
      await cdpB.send('Runtime.enable');
      await cdpB.send('Page.navigate', { url: BASE + '/?room=' + encodeURIComponent(room) });
      await sleep(1500);
      await cdpB.eval(setJoinFields('Аня', pass, room), false);
      await cdpB.eval(clickJoin, false);
      const sb = await waitFor(cdpB, inRoom, 25000);
      step('второе окно (Аня) в комнате', { room: sb.roomVisible, title: sb.roomTitle });

      // 1. Добавляем Аню кнопкой «+» в списке участников
      await sleep(2600);
      const before = await cdp.eval("(() => { const r = document.querySelector('#people .person:not(.is-friend) .friend-add'); return r ? r.textContent : ''; })()", false);
      await cdp.eval(`(() => {
        const rows = Array.from(document.querySelectorAll('#people .person'));
        const anya = rows.find((r) => (r.querySelector('.p-name') || {}).textContent && r.querySelector('.p-name').textContent.indexOf('Аня') >= 0);
        const btn = anya && anya.querySelector('.friend-add');
        if (btn) btn.click();
        return !!btn;
      })()`, false);
      await sleep(2600);
      const marked = await cdp.eval(`(() => {
        const rows = Array.from(document.querySelectorAll('#people .person'));
        const anya = rows.find((r) => (r.querySelector('.p-name') || {}).textContent && r.querySelector('.p-name').textContent.indexOf('Аня') >= 0);
        const btn = anya && anya.querySelector('.friend-add');
        return {
          text: btn ? btn.textContent : '',
          friendRow: !!(anya && anya.classList.contains('is-friend')),
          friends: window.__volnaDebug.friends(),
          selfHasButton: !!document.querySelector('#people .person .p-name') && Array.from(rows).some((r) => /·\s*вы\s*$/.test((r.querySelector('.p-name') || {}).textContent || '') && r.querySelector('.friend-add')),
        };
      })()`, false);
      step('отметка друга в списке', marked);

      // 2. Переходим в другую комнату и возвращаемся к другу кнопкой «Зайти»
      const roomB = 'friend' + Math.floor(Math.random() * 900 + 100);
      await cdp.eval(`(() => {
        document.querySelector('#setBtn').click();
        const i = document.querySelector('#newRoomInput');
        i.value = ${JSON.stringify(roomB)};
        document.querySelector('#newRoomBtn').click();
        return true;
      })()`, false);
      const s2 = await waitFor(cdp, (x) => x.roomVisible && x.roomTitle === roomB, 30000, 400);
      step('перешли в другую комнату', { стал: s2.roomTitle, ожидали: roomB });

      await cdp.eval("(() => { document.querySelector('#setBtn').click(); return true; })()", false);
      await sleep(800);
      await cdp.eval(`(() => {
        const rows = Array.from(document.querySelectorAll('#friendList .friend-row'));
        const row = rows.find((r) => r.textContent.indexOf('Аня') >= 0);
        if (row) {
          const visit = Array.from(row.querySelectorAll('button')).find((b) => b.textContent === 'Зайти');
          if (visit) visit.click();
        }
        return !!row;
      })()`, false);
      const s3 = await waitFor(cdp, (x) => x.roomVisible && x.roomTitle === roomA, 30000, 400);
      step('вернулись к другу', { стал: s3.roomTitle, ожидали: roomA });

      report.ok = inRoom(s) && inRoom(sb) && marked.text === '★' && marked.friendRow &&
        marked.friends.length === 1 && String(marked.friends[0].name) === 'Аня' &&
        String(marked.friends[0].room) === roomA && marked.selfHasButton === false &&
        s2.roomTitle === roomB && s3.roomTitle === roomA;
      cdpB.close();
    }

    if (scenario === 'icons') {
      // значки панели и вкладки меню должны быть видны и работать
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      const s = await waitFor(cdp, inRoom, 25000);
      const res = await cdp.eval(`(() => {
        const vis = (sel) => {
          const n = document.querySelector(sel);
          if (!n) return null;
          const st = getComputedStyle(n);
          const r = n.getBoundingClientRect();
          return { display: st.display, w: Math.round(r.width), h: Math.round(r.height), anim: st.animationName };
        };
        return {
          gear: vis('#setBtn .ic'),
          leave: vis('#leaveBtn .ic'),
          screen: vis('#screenBtn .ic.show'),
          panel: vis('#settings'),
        };
      })()`, false);
      step('значки панели', res);
      await cdp.eval("(() => { document.querySelector('#setBtn').click(); return true; })()", false);
      await sleep(800);
      const menu = await cdp.eval(`(() => {
        const panel = document.querySelector('#settings');
        const chips = Array.from(panel.querySelectorAll('.menu-tabs .chip'));
        const heads = Array.from(panel.querySelectorAll('.menu-head'));
        const r = panel.getBoundingClientRect();
        return {
          tabs: chips.map((c) => c.textContent.trim()),
          tabIcons: chips.map((c) => !!c.querySelector('svg')),
          active: chips.filter((c) => c.classList.contains('active')).map((c) => c.textContent.trim()),
          headIcons: heads.map((h) => (h.textContent || '').trim() + ':' + !!h.querySelector('svg')),
          fits: r.top >= -1 && r.bottom <= innerHeight + 1,
          anim: getComputedStyle(panel).animationName,
          soundVisible: !!panel.querySelector('.menu-pane[data-pane="sound"].active'),
        };
      })()`, false);
      step('вкладки меню', menu);
      await cdp.eval(`(() => { const c = Array.from(document.querySelectorAll('.menu-tabs .chip')).find((x) => x.dataset.pane === 'rooms'); if (c) c.click(); return true; })()`, false);
      await sleep(700);
      const rooms = await cdp.eval(`(() => ({
        roomsActive: !!document.querySelector('.menu-pane[data-pane="rooms"].active'),
        subRows: document.querySelectorAll('#subList .room-row').length,
        roomRows: document.querySelectorAll('#roomList .room-row').length,
        textRow: Array.from(document.querySelectorAll('#roomList .room-row')).some((r) => r.textContent.indexOf('Общая переписка') >= 0),
      }))()`, false);
      step('вкладка «Комнаты»', rooms);
      report.ok = inRoom(s) && res.gear && res.gear.display !== 'none' && res.gear.w > 4 &&
        res.leave && res.leave.display !== 'none' && res.leave.w > 4 &&
        menu.tabs.length === 4 && menu.tabIcons.every(Boolean) && menu.active.length === 1 &&
        menu.headIcons.length >= 4 && menu.headIcons.every((h) => h.endsWith('true')) && menu.fits &&
        rooms.roomsActive && rooms.textRow;
    }

    if (scenario === 'subrooms') {
      // подкомната: создаём из меню, проверяем вход и уведомление другим окном
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      const s = await waitFor(cdp, inRoom, 25000);
      const parent = s.roomTitle;

      const pageB = await newPage(DEBUG_PORT);
      const cdpB = await Cdp.connect(pageB.webSocketDebuggerUrl);
      await cdpB.send('Runtime.enable');
      await cdpB.send('Page.navigate', { url: BASE + '/?room=' + encodeURIComponent(room) });
      await sleep(1500);
      await cdpB.eval(setJoinFields('Коля', pass, room), false);
      await cdpB.eval(clickJoin, false);
      const sb = await waitFor(cdpB, inRoom, 25000);
      step('второе окно в комнате', { room: sb.roomVisible, title: sb.roomTitle });

      const sub = 'игры' + Math.floor(Math.random() * 90 + 10);
      await cdp.eval("(() => { document.querySelector('#setBtn').click(); return true; })()", false);
      await sleep(600);
      await cdp.eval("(() => { const c = Array.from(document.querySelectorAll('.menu-tabs .chip')).find((x) => x.dataset.pane === 'rooms'); if (c) c.click(); return true; })()", false);
      await sleep(600);
      await cdp.eval(`(() => {
        const i = document.querySelector('#newSubInput');
        i.value = ${JSON.stringify(sub)};
        document.querySelector('#newSubBtn').click();
        return true;
      })()`, false);
      const s2 = await waitFor(cdp, (x) => x.roomVisible && x.roomTitle.indexOf(sub) >= 0, 30000, 400);
      step('вошли в подкомнату', { title: s2.roomTitle, люди: s2.people });
      await sleep(2200);
      const atB = await cdpB.eval(`(() => ({
        subs: window.__volnaDebug.subs(),
        chatHasSub: document.querySelector('#chatLog').textContent.indexOf(${JSON.stringify(sub)}) >= 0,
      }))()`, false);
      step('второе окно узнало о подкомнате', atB);
      report.ok = inRoom(s) && inRoom(sb) && s2.roomTitle.indexOf(sub) >= 0 &&
        atB.subs.list.indexOf(sub) >= 0 && atB.chatHasSub;
      cdpB.close();
    }

    if (scenario === 'textroom') {
      // отдельная текстовая комната: без микрофона, с чатом
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      const s = await waitFor(cdp, inRoom, 25000);
      await cdp.eval("(() => { document.querySelector('#setBtn').click(); return true; })()", false);
      await sleep(600);
      await cdp.eval("(() => { const c = Array.from(document.querySelectorAll('.menu-tabs .chip')).find((x) => x.dataset.pane === 'rooms'); if (c) c.click(); return true; })()", false);
      await sleep(700);
      await cdp.eval(`(() => {
        const rows = Array.from(document.querySelectorAll('#roomList .room-row'));
        const text = rows.find((r) => r.textContent.indexOf('Общая переписка') >= 0);
        const go = text && Array.from(text.querySelectorAll('button')).find((b) => b.textContent === 'Войти');
        if (go) go.click();
        return !!go;
      })()`, false);
      const s2 = await waitFor(cdp, (x) => x.roomVisible && x.roomTitle.indexOf('Общая переписка') >= 0, 30000, 400);
      await sleep(1500);
      const state = await cdp.eval(`(() => {
        const d = window.__volnaDebug;
        const room = d.room();
        const lp = room && room.localParticipant;
        const micPub = lp && lp.getTrackPublication ? lp.getTrackPublication('microphone') : null;
        return {
          textRoom: d.textRoom(),
          title: (document.querySelector('#roomTitle') || {}).textContent,
          micPublished: !!(micPub && micPub.track),
          micWarn: !document.querySelector('#micWarn').classList.contains('hidden'),
          warnText: (document.querySelector('#micWarnText') || {}).textContent,
          chatOpen: !document.querySelector('#chatPanel').classList.contains('hidden'),
          room: d.currentRoom(),
        };
      })()`, false);
      step('текстовая комната', state);
      report.ok = inRoom(s) && s2.roomTitle.indexOf('Общая переписка') >= 0 && state.textRoom === true &&
        state.micPublished === false && state.micWarn === true && state.chatOpen === true;
    }

    if (scenario === 'privacy') {
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      const s = await waitFor(cdp, inRoom, 25000);
      await cdp.eval("(() => { document.querySelector('#setBtn').click(); return true; })()", false);
      await sleep(600);
      await cdp.eval("(() => { const c = Array.from(document.querySelectorAll('.menu-tabs .chip')).find((x) => x.dataset.pane === 'more'); if (c) c.click(); return true; })()", false);
      await sleep(500);
      const before = await cdp.eval("(() => ({ name: localStorage.getItem('volna.name'), anon: localStorage.getItem('volna.anon'), keys: Object.keys(localStorage).filter((k) => k.indexOf('volna.') === 0).length }))()", false);
      await cdp.eval("(() => { const t = document.querySelector('#anonToggle'); t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); return true; })()", false);
      await sleep(600);
      const after = await cdp.eval("(() => ({ name: localStorage.getItem('volna.name'), invite: localStorage.getItem('volna.invite'), anon: localStorage.getItem('volna.anon'), privacy: window.__volnaDebug.privacy() }))()", false);
      step('анонимный режим', { before: before, after: after });
      await cdp.eval("(() => { document.querySelector('#forgetBtn').click(); return true; })()", false);
      await sleep(2500);
      const cleared = await cdp.eval("(() => ({ keys: Object.keys(localStorage).filter((k) => k.indexOf('volna.') === 0).length, joinVisible: !document.querySelector('#joinScreen').classList.contains('hidden') }))()", false);
      step('после «Забыть всё»', cleared);
      report.ok = inRoom(s) && after.anon === '1' && after.privacy.anon === true &&
        (after.name === null || after.name === '') && (after.invite === null || after.invite === '') &&
        cleared.keys === 0;
    }

    if (scenario === 'endcall') {
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      const s = await waitFor(cdp, inRoom, 25000);
      const bar = await cdp.eval(`(() => {
        const btn = document.querySelector('#leaveBtn');
        const r = btn.getBoundingClientRect();
        const st = getComputedStyle(btn);
        const icon = btn.querySelector('.ic');
        const ir = icon.getBoundingClientRect();
        const path = icon.querySelector('path');
        const controls = document.querySelector('.controls').getBoundingClientRect();
        const last = Array.from(document.querySelectorAll('.controls .ctl')).filter((b) => !b.classList.contains('hidden')).pop();
        const lr = last.getBoundingClientRect();
        return {
          visible: r.width > 0 && r.height > 0 && st.display !== 'none',
          size: Math.round(r.width) + 'x' + Math.round(r.height),
          title: btn.title,
          aria: btn.getAttribute('aria-label'),
          bg: st.backgroundImage.slice(0, 40),
          iconShown: getComputedStyle(icon).display !== 'none' && ir.width > 4,
          filled: path ? path.getAttribute('fill') : '',
          lastButtonInside: Math.round(lr.right) <= innerWidth + 1,
          controlsInside: Math.round(controls.right) <= innerWidth + 1,
        };
      })()`, false);
      step('кнопка завершения звонка', bar);

      // Завершение через главное меню
      await cdp.eval("(() => { document.querySelector('#setBtn').click(); return true; })()", false);
      await sleep(600);
      await cdp.eval("(() => { const c = Array.from(document.querySelectorAll('.menu-tabs .chip')).find((x) => x.dataset.pane === 'more'); if (c) c.click(); return true; })()", false);
      await sleep(500);
      const menuBtn = await cdp.eval("(() => { const b = document.querySelector('#menuLeaveBtn'); return b ? { text: b.textContent.trim(), visible: !b.closest('.menu-pane').classList.contains('hidden') === false } : null; })()", false);
      step('кнопка в меню', menuBtn);
      await cdp.eval("(() => { document.querySelector('#menuLeaveBtn').click(); return true; })()", false);
      const leftByMenu = await waitFor(cdp, (x) => x.joinVisible && !x.roomVisible, 10000, 300);
      step('завершение из меню', { join: leftByMenu.joinVisible, room: leftByMenu.roomVisible });

      // Завершение красной кнопкой
      await fill();
      await cdp.eval(clickJoin, false);
      const s2 = await waitFor(cdp, inRoom, 25000);
      await cdp.eval(clickLeave, false);
      const leftByBtn = await waitFor(cdp, (x) => x.joinVisible && !x.roomVisible, 10000, 300);
      step('завершение кнопкой', { join: leftByBtn.joinVisible, room: leftByBtn.roomVisible });

      report.ok = inRoom(s) && bar.visible && bar.iconShown && bar.filled === 'currentColor' &&
        /Завершить/.test(bar.title) && bar.lastButtonInside && bar.controlsInside &&
        !!menuBtn && /Завершить звонок/.test(menuBtn.text) &&
        leftByMenu.joinVisible && !leftByMenu.roomVisible &&
        inRoom(s2) && leftByBtn.joinVisible && !leftByBtn.roomVisible;
    }

    if (scenario === 'stun') {
      await open();
      const cands = await cdp.eval(`(async () => {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        const out = [];
        pc.onicecandidate = (e) => { if (e.candidate) out.push(e.candidate.candidate); };
        pc.createDataChannel('x');
        await pc.setLocalDescription(await pc.createOffer());
        await new Promise((r) => setTimeout(r, 6000));
        pc.close();
        return out;
      })()`, true);
      step('кандидаты Chrome со STUN', cands);
      report.ok = Array.isArray(cands) && cands.some((c) => c.indexOf('typ srflx') >= 0);
    }

    if (scenario === 'icediag') {
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      await sleep(7000);
      const info = await cdp.eval(`(() => {
        const r = window.__volnaLastRoom;
        const ice = document.documentElement.dataset.volnaIce || '';
        const engine = r && r.engine ? r.engine : null;
        let cfg = null;
        try { cfg = engine && engine.rtcConfig ? engine.rtcConfig : null; } catch (e) { cfg = 'err'; }
        return {
          iceFromClient: ice,
          engineCfg: cfg ? JSON.stringify(cfg) : 'нет',
          connOptions: r && r.connOptions ? JSON.stringify(r.connOptions.rtcConfig || null) : 'нет',
          state: r ? String(r.state) : 'нет комнаты',
        };
      })()`, false);
      step('настройки ICE в клиенте', info);
      const pcs = await cdp.eval(`(async () => {
        const list = window.__volnaPCs || [];
        const out = [];
        for (const item of list) {
          const cfg = item.pc.getConfiguration ? item.pc.getConfiguration() : {};
          const stats = await item.pc.getStats();
          const types = {};
          const pairs = [];
          const remote = [];
          stats.forEach((v) => {
            if (v.type === 'local-candidate') types[v.candidateType] = (types[v.candidateType] || 0) + 1;
            if (v.type === 'remote-candidate') remote.push(v.candidateType + ' ' + v.address + ':' + v.port);
            if (v.type === 'candidate-pair') pairs.push({ state: v.state, nom: v.nominated, sent: v.requestsSent, recv: v.requestsReceived });
          });
          out.push({
            iceServers: JSON.stringify((cfg.iceServers || []).map((s) => s.urls)),
            localTypes: types,
            remoteCandidates: remote.slice(0, 6),
            pairs: pairs.slice(0, 3),
            connState: item.pc.connectionState,
            iceState: item.pc.iceConnectionState,
          });
        }
        return out;
      })()`, true);
      step('peer connections клиента', pcs);
      report.ok = !!(info && info.engineCfg && info.engineCfg.indexOf('stun.l.google.com') >= 0);
    }

    if (scenario === 'invitespace') {
      // так выглядит ссылка, если её скопировали из мессенджера вместе с пробелом,
      // переводом строки и кавычками — приложение должно всё равно подключиться
      const code = Buffer.from(JSON.stringify({ r: room, k: pass }), 'utf8').toString('base64url');
      const messy = '%20%22' + code + '%20%22%0A';
      await cdp.send('Page.navigate', { url: BASE + '/#i=' + messy });
      await sleep(1500);
      const s0 = await cdp.eval(SNAPSHOT, false);
      step('ссылка с мусором на конце', { inviteBanner: s0.inviteBanner, passHidden: s0.passHidden, room: s0.roomInput });
      const s = await waitFor(cdp, inRoom, 20000, 500);
      step('подключение', { room: s.roomVisible, title: s.roomTitle, people: s.people });
      report.ok = inRoom(s);
    }

    if (scenario === 'shotlogin') {
      // Снимок экрана входа: без подключения к комнате
      await open();
      await sleep(2500);
      if (process.env.VOLNA_SHOT_W) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: Number(process.env.VOLNA_SHOT_W || 1280),
          height: Number(process.env.VOLNA_SHOT_H || 800),
          deviceScaleFactor: 1,
          mobile: false,
        });
        await sleep(800);
      }
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = join(process.cwd(), 'shot-login-' + Date.now() + '.png');
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      step('снимок экрана входа', { file });
      report.ok = true;
    }

    if (scenario === 'shot') {
      // Снимок интерфейса — чтобы проверять вёрстку (чат внизу списка участников)
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      await sleep(6000);
      if (process.env.VOLNA_SHOT_W) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: Number(process.env.VOLNA_SHOT_W || 1280),
          height: Number(process.env.VOLNA_SHOT_H || 800),
          deviceScaleFactor: 1,
          mobile: false,
        });
        await sleep(1200);
      }
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = join(process.cwd(), 'shot-' + Date.now() + '.png');
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      step('снимок сохранён', { file: file });
      report.ok = true;
    }

    if (scenario === 'subcreate') {
      // создание подкомнаты кнопкой «＋» в левой колонке: без диалогов, имя короткое
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      await waitFor(cdp, inRoom, 15000, 500);
      const before = await cdp.eval(`(() => ({
        rows: Array.from(document.querySelectorAll('#channelList .chan-row')).map((r) => r.textContent.trim()),
        title: (document.querySelector('#roomTitle') || {}).textContent || '',
      }))()`, false);
      await cdp.eval(`document.querySelector('#channelList .chan-add').click()`, false);
      await sleep(400);
      const editing = await cdp.eval(`(() => ({
        hasInput: !!document.querySelector('#chanNewRow input'),
        focused: document.activeElement === document.querySelector('#chanNewRow input'),
      }))()`, false);
      await cdp.eval(`(() => {
        const input = document.querySelector('#chanNewRow input');
        input.value = '';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`, false);
      let seenJoin = false;
      for (let i = 0; i < 12; i++) {
        await sleep(250);
        const state = await cdp.eval(`(() => ({
          join: !(document.querySelector('#joinScreen') || {}).classList.contains('hidden'),
          room: !(document.querySelector('#roomScreen') || {}).classList.contains('hidden'),
        }))()`, false);
        if (state.join) seenJoin = true;
      }
      const after = await cdp.eval(`(() => ({
        rows: Array.from(document.querySelectorAll('#channelList .chan-row')).map((r) => r.textContent.trim()),
        title: (document.querySelector('#roomTitle') || {}).textContent || '',
        chatTitle: (document.querySelector('#chatTitle') || {}).textContent || '',
        inRoom: !(document.querySelector('#roomScreen') || {}).classList.contains('hidden'),
        chatVisible: !(document.querySelector('#chatPanel') || {}).classList.contains('hidden'),
      }))()`, false);
      after.seenJoin = seenJoin;

      // второй проход: создаём комнату со своим названием — имя должно примениться сразу
      await cdp.eval(`document.querySelector('#channelList .chan-add').click()`, false);
      await sleep(400);
      await cdp.eval(`(() => {
        const input = document.querySelector('#chanNewRow input');
        input.value = 'Моя комната';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`, false);
      await sleep(4000);
      const named = await cdp.eval(`(() => ({
        rows: Array.from(document.querySelectorAll('#channelList .chan-row')).map((r) => r.textContent.trim()),
        chatTitle: (document.querySelector('#chatTitle') || {}).textContent || '',
      }))()`, false);
      step('комната со своим именем', named);
      step('до создания', before);
      step('поле ввода', editing);
      step('после создания', after);
      report.ok = !!editing.hasInput && after.rows.length === 2 && after.rows[1].indexOf('Subroom 1') >= 0 && after.title === 'Volna' && !seenJoin && after.chatVisible && named.rows.length === 3 && named.chatTitle.indexOf('о') >= 0;
    }

    if (scenario === 'screenshare') {
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      await waitFor(cdp, inRoom, 15000, 500);
      const probe = await cdp.eval(`(async () => {
        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
          const track = stream.getVideoTracks()[0];
          const settings = track ? track.getSettings() : {};
          stream.getTracks().forEach((t) => t.stop());
          return { ok: true, width: settings.width || 0, height: settings.height || 0 };
        } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
      })()`, true);
      step('захват экрана напрямую', probe);
      await sleep(1500);
      const spot = await cdp.eval(`(() => { const el = document.querySelector('#screenBtn'); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), title: el.title }; })()`, false);
      step('кнопка демонстрации', spot);
      const hit = await cdp.eval(`(() => { const el = document.elementFromPoint(${spot.x}, ${spot.y}); return el ? (el.id || el.className || el.tagName) : 'нет'; })()`, false);
      step('что под точкой клика', hit);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
      let state = null;
      for (let i = 0; i < 20; i++) {
        await sleep(700);
        state = await cdp.eval(`(() => {
          const wrap = document.querySelector('#stageWrap');
          const video = document.querySelector('#stageVideo');
          return {
            wrapVisible: !!wrap && !wrap.classList.contains('hidden'),
            width: video ? video.videoWidth : 0,
            height: video ? video.videoHeight : 0,
            paused: video ? video.paused : null,
            label: (document.querySelector('#stageLabel') || {}).textContent || '',
            toasts: Array.from(document.querySelectorAll('#toasts .toast')).map((t) => t.textContent).slice(-3),
            gdmError: window.__gdmError || '',
            rejection: window.__lastRejection || '',
          };
        })()`, false);
        if (state.width > 0) break;
      }
      step('демонстрация экрана', state);
      report.ok = !!state && state.wrapVisible && state.width > 0;
    }

    if (scenario === 'badpass') {
      await open();
      await cdp.eval(setJoinFields(name, 'неверный-пароль-123', room), false);
      await cdp.eval(clickJoin, false);
      const s = await waitFor(cdp, (x) => inRoom(x) || (x.joinHint !== '' && x.joinHint !== 'Подключаемся…'), 25000);
      step('вход с неверным паролем', { room: s.roomVisible, hint: s.joinHint, btnDisabled: s.joinBtnDisabled, toasts: s.toasts });
      await fill();
      await cdp.eval(clickJoin, false);
      const s2 = await waitFor(cdp, (x) => inRoom(x) || (x.joinHint !== '' && x.joinHint !== 'Подключаемся…' && x.joinHint !== s.joinHint), 25000);
      step('вход с верным паролем после ошибки', { room: s2.roomVisible, hint: s2.joinHint, toasts: s2.toasts });
      report.ok = inRoom(s2);
    }

    if (scenario === 'keepalive') {
      // вход, ожидание 8 секунд, проверка что связь жива и слышны участники
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      const s = await waitFor(cdp, inRoom, 25000);
      step('вход', { room: s.roomVisible, people: s.people });
      await sleep(8000);
      const s2 = await cdp.eval(SNAPSHOT, false);
      step('через 8 секунд', s2);
      report.ok = inRoom(s2) && s2.connDot.includes('ok');
    }

    // ошибки страницы
    const errs = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown').map(
      (e) => e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text
    );
    if (errs.length) { report.errors.push(...errs); step('ошибки в консоли страницы', errs); }
  } catch (e) {
    report.ok = false;
    report.errors.push(String(e && e.message ? e.message : e));
    console.log('  ! ' + (e && e.message ? e.message : e));
  } finally {
    if (cdp) cdp.close();
    try { await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${(await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).map(p=>p.id).join(',')}`); } catch { /* не критично */ }
    try { chrome.kill(); } catch { /* уже мёртв */ }
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* профиль занят — не мешает */ }
    console.log('\nИТОГ ' + scenario + ': ' + (report.ok ? 'OK' : 'ПРОВАЛ'));
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }
}

main();
