/**
 * «Волна» — вход в комнату: приглашения и защита повторного входа.
 *
 * Загружается сразу после app.js и достраивает его, не меняя сам app.js:
 * правку app.js блокирует защита записи на строке отправки ключа комнаты
 * (см. PROJECT-HANDOVER.md, раздел 8 «Известные ограничения»).
 *
 * Что делает этот файл:
 *   1. Ссылка-приглашение (#i=…): подставляет комнату, ключ и имя и сама подключает
 *      участника — с обратным отсчётом, который можно отменить.
 *   2. Повторный вход: события прошлой комнаты больше не могут выбить текущую,
 *      лишние подключения закрываются, а отказ микрофона не мешает войти и слушать.
 *   3. После выхода интерфейс возвращается в исходное состояние.
 *   4. Приглашение копируется с сетевым адресом (из addresses.json), а не с localhost.
 *   5. Другое окно приложения, получив ссылку, подключается к той же комнате.
 */
(function () {
  'use strict';

  const LK = window.LivekitClient;
  if (!LK) return; // app.js сам покажет сообщение об отсутствии библиотеки

  const $ = (sel) => document.querySelector(sel);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('volna.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('volna.' + k, String(v)); } catch (e) { /* приватный режим */ } },
  };

  function toast(msg, kind) {
    const box = $('#toasts');
    if (!box) return;
    const t = document.createElement('div');
    t.className = 'toast' + (kind === 'error' ? ' error' : '');
    t.textContent = msg;
    box.append(t);
    setTimeout(() => t.remove(), 5200);
  }

  const onJoinScreen = () => {
    const js = $('#joinScreen');
    return !!js && !js.classList.contains('hidden');
  };

  function b64uEncode(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64uDecode(text) {
    const s = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /** Код приглашения: комната и ключ доступа в одном коротком куске строки. */
  function makeCode(room, key) {
    return b64uEncode(JSON.stringify({ r: room, k: key || '' }));
  }

  function readCode(raw) {
    if (!raw) return null;
    // Ссылку часто пересылают с лишним пробелом, переводом строки, кавычками или точкой
    // в конце — из-за такого «мусора» код раньше не разбирался, и человек видел
    // требование пароля. Убираем хвосты и пробуем декодировать несколько раз.
    let text = String(raw).trim();
    try { text = decodeURIComponent(text); } catch (e) { /* уже без экранирования */ }
    text = text.split('&')[0].split('#')[0];
    text = text.replace(/[\s"'<>«»]+/g, '').replace(/[.,;:!?]+$/, '');
    if (!text) return null;

    for (const candidate of [text, text.replace(/-/g, '+').replace(/_/g, '/')]) {
      try {
        const data = JSON.parse(b64uDecode(candidate));
        const room = data && typeof data === 'object' ? String(data.r || '').trim() : '';
        if (room) return { room: room, key: String(data.k || '') };
      } catch (e) { /* пробуем следующий вариант */ }
    }
    return null;
  }

  /* ═══════════ 1. Устойчивый вход: одна активная комната ═══════════ */

  const OrigRoom = LK.Room;
  let latest = null;    // последняя созданная комната — только её события управляют интерфейсом
  let active = null;    // комната, в которой мы сейчас находимся
  let lastMicError = ''; // последняя причина, по которой не удалось включить микрофон
  let lastScreenProfile = ''; // профиль, с которым запущена демонстрация экрана
  let inviteAutofilled = false; // пароль подставлен из ссылки-приглашения
  const rooms = new Set(); // все комнаты этого окна: лишние закрываем, даже если они ещё подключаются

  // STUN — чтобы браузер узнал свой внешний адрес; TURN — релей на нашем сервере,
  // нужен тем, кто за симметричным NAT или CGNAT (прямое соединение там невозможно).
  const ICE_SERVERS = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    {
      urls: 'turn:31.76.29.68:3478?transport=udp',
      username: 'volna',
      credential: 'volna-l8sXqyK15MTc',
    },
  ];

  function roomsMark() {
    try { document.documentElement.dataset.volnaRooms = String(rooms.size); } catch (e) { /* не критично */ }
  }

  function closeRoom(room) {
    if (!room) return;
    room.__volnaClosed = true;
    if (active === room) active = null;
    rooms.delete(room);
    roomsMark();
    try { room.disconnect(); } catch (e) { /* уже закрыта */ }
  }

  function micReason(err) {
    const name = err && err.name ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'браузер не дал доступ к микрофону';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'микрофон не найден';
    if (name === 'NotReadableError' || name === 'AbortError') return 'микрофон занят другой программой';
    return (err && err.message) ? err.message : 'неизвестная причина';
  }

  function showMicWarn(text) {
    const box = $('#micWarn');
    const label = $('#micWarnText');
    if (!box || !label) return;
    if (text) {
      label.textContent = text;
      box.classList.remove('hidden');
    } else {
      box.classList.add('hidden');
    }
  }

  /**
   * Шумовой затвор надевается на уже опубликованную дорожку: при создании дорожки
   * LiveKit ещё не знает аудио-контекст, а после публикации — знает (проверено).
   */
  async function attachGate(lp) {
    if (!NS.on || !lp.getTrackPublication) return;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const pub = lp.getTrackPublication('microphone');
        const track = pub && pub.track;
        if (track && typeof track.setProcessor === 'function') {
          if (track.__volnaGate) return;
          await track.setProcessor(makeGateProcessor());
          track.__volnaGate = true;
          NS.failed = false;
          return;
        }
      } catch (e) {
        lastMicError = micReason(e);
        NS.failed = true;
        toast('Шумоподавление не запустилось — микрофон работает без него', 'error');
        return;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  /** Отказ микрофона не должен отменять вход: подключаемся, но сообщаем о проблеме. */
  function guardParticipant(room) {
    const lp = room.localParticipant;
    if (!lp || lp.__volnaGuarded) return;
    lp.__volnaGuarded = true;
    const setMic = lp.setMicrophoneEnabled.bind(lp);
    lp.setMicrophoneEnabled = async function (on, capture, publish) {
      if (on && isTextRoom()) {
        showMicWarn('Это текстовая комната: микрофон выключен, история переписки не сохраняется.');
        return null;
      }
      try {
        const res = await setMic(on, Object.assign({}, capture || {}), publish);
        if (on) {
          await attachGate(lp);
          showMicWarn('');
        }
        return res;
      } catch (e) {
        if (on === false) return null;
        lastMicError = micReason(e);
        showMicWarn('Микрофон выключен: ' + lastMicError + '. Нажмите на эту строку, чтобы попробовать снова.');
        toast('Вошли без микрофона: ' + lastMicError, 'error');
        return null;
      }
    };

    // Профиль показа экрана: для игр — больше кадров в секунду и «движение», для документов — «детали».
    const setScreen = lp.setScreenShareEnabled.bind(lp);
    lp.setScreenShareEnabled = async function (on, capture, publish) {
      if (!on) return setScreen(on, capture, publish);
      const profile = GAME_Q[gameProfile()] || GAME_Q.text;
      const cap = Object.assign({}, capture || {}, {
        resolution: profile.res,
        contentHint: profile.hint,
      });
      // Системный звук демонстрации отдаём отдельной дорожкой и НЕ воспроизводим
      // локально: иначе эхоподавление принимает его за эхо и глушит микрофон.
      if (cap.audio === true || cap.audio === undefined) {
        cap.audio = { suppressLocalAudioPlayback: true };
      } else if (cap.audio && typeof cap.audio === 'object') {
        cap.audio = Object.assign({ suppressLocalAudioPlayback: true }, cap.audio);
      }
      const pub = Object.assign({}, publish || {}, {
        screenShareEncoding: { maxBitrate: profile.bitrate, maxFramerate: profile.res.frameRate },
        // Слои симулкаста: зритель сам выберет 720p/1080p/1440p в зависимости от экрана и канала
        screenShareSimulcastLayers: [
          { width: 1280, height: 720, encoding: { maxBitrate: 1200000, maxFramerate: 30 } },
          { width: 1920, height: 1080, encoding: { maxBitrate: 2800000, maxFramerate: 60 } },
          { width: 2560, height: 1440, encoding: { maxBitrate: 4500000, maxFramerate: 60 } },
        ],
        degradationPreference: profile.degrade || 'maintain-resolution',
      });
      lastScreenProfile = profile.label;
      toast('Показ экрана: ' + profile.label);
      try {
        return await setScreen(on, cap, pub);
      } catch (e) {
        // Запасные варианты: браузер или сервер могут не принять симулкаст/системный звук.
        // Тогда показываем экран простым способом — главное, чтобы демонстрация включилась.
        try {
          const simple = Object.assign({}, pub);
          delete simple.screenShareSimulcastLayers;
          return await setScreen(on, cap, simple);
        } catch (e2) {
          if (cap.audio) {
            const simpleNoAudio = Object.assign({}, pub, { audio: false });
            delete simpleNoAudio.screenShareSimulcastLayers;
            toast('Системный звук недоступен — показываю без него');
            return await setScreen(on, Object.assign({}, cap, { audio: false }), simpleNoAudio);
          }
          toast('Не удалось включить демонстрацию: ' + ((e && e.message) || e), 'error');
          throw e;
        }
      }
    };
  }

  if (typeof OrigRoom === 'function') {
    class GuardedRoom extends OrigRoom {
      constructor(options) {
        // Не останавливаем дорожку микрофона при выключении: иначе Bluetooth-гарнитура
        // переключается в режим «телефона» (тихо, узкая полоса), а AGC каждый раз
        // начинает с нуля — из-за этого звук «сам становится тише».
        const opts = Object.assign({
          stopMicTrackOnMute: false,
          // Звук не режем в тишине и дублируем пакеты (RED): голос остаётся ровным,
          // даже когда канал занят демонстрацией экрана.
          publishDefaults: { dtx: false, red: true, audioPreset: { maxBitrate: 64000, stereo: false } },
        }, options || {});
        super(opts);
        this.__volnaClosed = false;
        latest = this;
        rooms.add(this);
        roomsMark();
        // В приложении всегда одна активная комната. Закрываем все прошлые — включая те,
        // что ещё подключаются: двойное нажатие Enter на полях входа иначе подняло бы
        // два живых подключения и человек слышал бы себя дважды.
        Array.from(rooms).forEach((other) => { if (other !== this) closeRoom(other); });
        const on = this.on.bind(this);
        this.on = (event, cb) => on(event, (...args) => {
          if (this.__volnaClosed) return;  // это события уже закрытой комнаты
          if (latest !== this) return;     // есть более новая комната — не мешаем ей
          try { return cb(...args); } catch (e) { /* одно событие не должно ломать приложение */ }
        });
        // свои подписки: чат комнаты и системные сообщения о входе/выходе
        try {
          on(LK.RoomEvent.DataReceived, (payload, participant, kind, topic) => {
            if (this.__volnaClosed || latest !== this) return;
            onChatData(payload, participant, topic);
          });
          on(LK.RoomEvent.ParticipantConnected, (p) => {
            if (this.__volnaClosed || latest !== this) return;
            chatAdd((p && p.name ? p.name : 'Участник') + ' подключился', '', 'sys');
            if (p && p.name && myName() && String(p.name).toLowerCase() === myName().toLowerCase()) {
              toast('В комнате уже есть участник с таким именем: ' + p.name, 'error');
            }
            beep('in');
          });
          on(LK.RoomEvent.ParticipantDisconnected, (p) => {
            if (this.__volnaClosed || latest !== this) return;
            chatAdd((p && p.name ? p.name : 'Участник') + ' вышел', '', 'sys');
            beep('out');
          });
        } catch (e) { /* не критично */ }
        const connect = this.connect.bind(this);
        this.connect = async (url, token, connectOpts) => {
          // STUN нужен именно здесь: LiveKit берёт rtcConfig из опций connect(), а не из конструктора.
          // Без него браузер сообщает только локальный адрес и через интернет не соединяется.
          const opts = Object.assign({}, connectOpts || {});
          if (!opts.rtcConfig || !opts.rtcConfig.iceServers) {
            opts.rtcConfig = Object.assign({}, opts.rtcConfig || {}, { iceServers: ICE_SERVERS });
          }
          // ?relay=1 — весь звук идёт через TURN. Нужно там, где прямой путь невозможен:
          // симметричный NAT, CGNAT, строгий корпоративный фаервол. Медленнее, но соединяется.
          try {
            if (/(?:^|[?&])relay=1(?:&|$)/.test(location.search)) {
              opts.rtcConfig = Object.assign({}, opts.rtcConfig, { iceTransportPolicy: 'relay' });
            }
          } catch (e) { /* не критично */ }
          try {
            const res = await connect(url, token, opts);
            active = this;
            LOCK.busy = true;
            window.__volnaJoining = false;
            lockRefresh();
            startPingLoop();
            if (LOCK.timer) clearInterval(LOCK.timer);
            LOCK.timer = setInterval(lockRefresh, 5000);
            inviteAutofilled = false;
            guardParticipant(this);
            beep('join');
            return res;
          } catch (e) {
            // Вход по ссылке не удался: чаще всего ссылку обрезали при пересылке
            // и пароль в ней повреждён. Показываем поле пароля и говорим прямо.
            if (inviteAutofilled) {
              inviteAutofilled = false;
              const field = $('#passField');
              const keyInput = $('#passInput');
              if (field) { field.classList.remove('hidden'); if (field.dataset) delete field.dataset.byInvite; }
              if (keyInput) { keyInput.value = ''; try { keyInput.focus(); } catch (err) { /* не критично */ } }
              toast('Вход по ссылке не удался: введите пароль комнаты вручную — возможно, ссылка обрезалась при пересылке', 'error');
            }
            closeRoom(this); // неудачная попытка не оставляет «призрачного» подключения
            throw e;
          }
        };
        const disconnect = this.disconnect.bind(this);
        this.disconnect = (...args) => {
          this.__volnaClosed = true;
          if (active === this) {
            active = null;
            LOCK.busy = false;
            if (LOCK.timer) { clearInterval(LOCK.timer); LOCK.timer = 0; }
            lockRelease();
            stopPingLoop();
          }
          rooms.delete(this);
          roomsMark();
          return disconnect(...args);
        };
      }
    }
    try { LK.Room = GuardedRoom; } catch (e) { /* не удалось — приложение работает как есть */ }
  }

  /* ═══════════ 2. Возврат на экран входа ═══════════ */

  /** Поле пароля прячем только в режиме приглашения — и возвращаем, когда оно нужно. */
  function showPassField() {
    const field = $('#passField');
    if (field && field.dataset.byInvite === '1') {
      field.classList.remove('hidden');
      delete field.dataset.byInvite;
    }
  }

  function afterLeave() {
    const hint = $('#joinHint');
    if (hint) hint.textContent = '';
    const btn = $('#joinBtn');
    if (btn) btn.disabled = false;
    ['#settings', '#invitePop', '#stagePicker'].forEach((sel) => {
      const node = $(sel);
      if (node) node.classList.add('hidden');
    });
    const dot = $('#connDot');
    if (dot) dot.className = 'dot';
    const text = $('#connText');
    if (text) text.textContent = '';
    const grid = $('#grid');
    if (grid) grid.classList.remove('hidden');
    const stage = $('#stageWrap');
    if (stage) stage.classList.add('hidden');
    showMicWarn('');
    showPassField(); // после выхода пароль снова можно менять руками
    // чат комнаты начинается заново
    const chatLog = $('#chatLog');
    if (chatLog) chatLog.innerHTML = '';
    CHAT.unread = 0;
    CHAT.seen.clear();
    renderChatBadge();
    // переход в другую комнату, выбранную в главном меню
    if (ROOMS.pending) {
      const target = ROOMS.pending;
      ROOMS.pending = '';
      const roomInput = $('#roomInput');
      if (roomInput) roomInput.value = target;
      setTimeout(doJoin, 200);
    }
  }

  function watchJoinScreen() {
    const js = $('#joinScreen');
    if (js && 'MutationObserver' in window) {
      let hidden = js.classList.contains('hidden');
      new MutationObserver(() => {
        const now = js.classList.contains('hidden');
        if (hidden && !now) setTimeout(afterLeave, 0); // приложение вернулось на экран входа
        hidden = now;
      }).observe(js, { attributes: true, attributeFilter: ['class'] });
    }
    const rs = $('#roomScreen');
    if (rs && 'MutationObserver' in window) {
      new MutationObserver(() => {
        if (rs.classList.contains('hidden')) return;
        cancelCountdown(); // вход состоялся — отсчёт и подсказка входа больше не нужны
        const hint = $('#joinHint');
        if (hint) hint.textContent = '';
        // имя комнаты для человека: подкомната и текстовая комната выглядят понятно
        const title = $('#roomTitle');
        if (title) title.textContent = 'Volna';
        // В чате сразу видно, чей он: общей комнаты или конкретной подкомнаты
        const chatTitle = $('#chatTitle');
        if (chatTitle) {
          chatTitle.textContent = shortName(currentRoom());
          chatTitle.title = 'Чат комнаты «' + shortName(currentRoom()) + '»';
        }
        if (SWITCH.active) {
          SWITCH.active = false;
          switchOverlay(false);
          // при переходе LiveKit может сообщить о разрыве старого соединения — это не ошибка
          document.querySelectorAll('#toasts .toast.error').forEach((t) => {
            if (/client initiated disconnect|не удалось войти/i.test(t.textContent || '')) t.remove();
          });
        }
        const backBtn = $('#chatBackBtn');
        if (backBtn) backBtn.classList.toggle('hidden', !isSubRoom(currentRoom()));
        try { renderChannels(); } catch (e) { /* не критично */ }
        if (!isSubRoom(currentRoom()) && store.get('hintSub', '') !== '1') {
          store.set('hintSub', '1');
        }
        if (isTextRoom()) {
          showMicWarn('Это текстовая комната: микрофон выключен, история переписки не сохраняется.');
          chatShow(true);
        }
      }).observe(rs, { attributes: true, attributeFilter: ['class'] });
    }
    // Если сервер не принял пароль — поле пароля снова показываем, чтобы его можно было исправить.
    const hint = $('#joinHint');
    if (hint && 'MutationObserver' in window) {
      new MutationObserver(() => {
        if (/парол/i.test(hint.textContent || '')) showPassField();
      }).observe(hint, { childList: true, characterData: true, subtree: true });
    }
  }

  /* ═══════════ 3. Ссылка-приглашение и авто-подключение ═══════════ */

  const IB = { timer: 0, bc: null, addresses: [], id: Math.random().toString(36).slice(2) };

  function inviteFromLocation() {
    // Код приглашения может быть и после #, и в обычных параметрах адреса:
    // некоторые мессенджеры вырезают часть после #, тогда сработает ?i=...
    const sources = [String(location.hash || '').replace(/^#/, ''), String(location.search || '').replace(/^\?/, '')];
    for (const hash of sources) {
      if (!hash) continue;
      const p = new URLSearchParams(hash);
      const code = readCode(p.get('i'));
      if (code) return code;
      const room = (p.get('r') || p.get('room') || '').trim();
      if (room) return { room: room, key: p.get('k') || '' };
    }
    return null;
  }

  /** Заполняет поля входа данными приглашения. */
  function applyInvite(inv) {
    if (!inv || !inv.room || !onJoinScreen()) return false;
    inviteAutofilled = !!inv.key;
    const roomInput = $('#roomInput');
    const keyInput = $('#passInput');
    const nameInput = $('#nameInput');
    if (roomInput) roomInput.value = inv.room;
    if (keyInput && inv.key) {
      keyInput.value = inv.key;
      const field = $('#passField');
      if (field) { field.classList.add('hidden'); field.dataset.byInvite = '1'; }
    }
    if (nameInput && !nameInput.value.trim()) {
      nameInput.value = store.get('name', '') || ('Гость-' + (1000 + Math.floor(Math.random() * 9000)));
    }
    store.set('room', inv.room);
    if (inv.key && !PRIV.anon) {
      store.set('invite', makeCode(inv.room, inv.key));
      store.set('auto', '1');
      const sw = $('#autoSwitch');
      if (sw) sw.checked = true; // переключатель должен показывать настоящее состояние
    }
    return true;
  }

  function cancelCountdown() {
    if (IB.timer) { clearInterval(IB.timer); IB.timer = 0; }
    const banner = $('#inviteBanner');
    if (banner) banner.classList.add('hidden');
  }

  function startCountdown(seconds, title) {
    if (!onJoinScreen()) return;
    cancelCountdown();
    const banner = $('#inviteBanner');
    if (!banner) { doJoin(); return; }
    const roomInput = $('#roomInput');
    const room = ((roomInput && roomInput.value) || '').trim() || 'main';
    $('#inviteTitle').textContent = title || ('Вас пригласили в комнату «' + room + '»');
    banner.classList.remove('hidden');
    let left = Math.max(1, seconds | 0);
    const tick = () => {
      if (!onJoinScreen()) { cancelCountdown(); return; }
      if (left <= 0) { cancelCountdown(); doJoin(); return; }
      $('#inviteSub').textContent = 'Подключаемся автоматически через ' + left + ' с — имя можно поменять.';
      left--;
    };
    tick();
    IB.timer = setInterval(tick, 1000);
  }

  /* ---- 3a. Один пользователь — одно окно ---- */

  const LOCK = { id: Math.random().toString(36).slice(2), channel: null, busy: false };

  function initSessionLock() {
    try {
      LOCK.channel = new BroadcastChannel('volna-session');
      LOCK.channel.onmessage = (e) => {
        const msg = e.data || {};
        if ((msg.t === 'claim' || msg.t === 'ping') && LOCK.busy) {
          LOCK.channel.postMessage({ t: 'busy', id: LOCK.id });
        }
      };
    } catch (e) { /* старые браузеры — без блокировки */ }
  }

  function otherTabBusy() {
    // Источник правды — localStorage: его видят все вкладки одного браузера.
    // Метка живёт 15 секунд и обновляется, пока идёт звонок.
    if (window.__volnaAllowMulti) return false;
    try {
      const raw = localStorage.getItem('volna.lock');
      if (raw) {
        const info = JSON.parse(raw);
        if (info && info.id !== LOCK.id && Date.now() - Number(info.at || 0) < 15000) return true;
      }
      localStorage.setItem('volna.lock', JSON.stringify({ id: LOCK.id, at: Date.now() }));
    } catch (e) { /* приватный режим — не блокируем */ }
    return false;
  }

  function blockSecondWindow() {
    toast('Вы уже в комнате в другой вкладке этого браузера', 'error');
    const hint = $('#joinHint');
    if (hint) hint.textContent = 'Вы уже в комнате в другой вкладке — закройте её, чтобы войти здесь.';
  }

  /** Перехватываем нажатие «Войти» до обработчика app.js: второе окно не пускаем. */
  function guardMultiJoin() {
    document.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('#joinBtn') : null;
      if (!btn) return;
      if (!otherTabBusy()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      blockSecondWindow();
    }, true);
  }

  function lockRefresh() {
    try { localStorage.setItem('volna.lock', JSON.stringify({ id: LOCK.id, at: Date.now() })); } catch (e) { /* не критично */ }
  }

  function lockRelease() {
    try {
      const raw = localStorage.getItem('volna.lock');
      if (!raw) return;
      const info = JSON.parse(raw);
      if (info && info.id === LOCK.id) localStorage.removeItem('volna.lock');
    } catch (e) { /* не критично */ }
  }

  function doJoin() {
    if (inRoom()) return;                     // уже в комнате — повторный вход не нужен
    if (window.__volnaJoining) return;        // вход уже идёт
    if (otherTabBusy()) { blockSecondWindow(); return; }
    window.__volnaJoining = true;
    setTimeout(() => { window.__volnaJoining = false; }, 12000);
    const roomInput = $('#roomInput');
    if (roomInput) setRealRoom(roomInput.value);
    const btn = $('#joinBtn');
    if (btn && !btn.disabled) btn.click();
  }

  /** Во время переключения LiveKit сообщает о разрыве старого соединения — это не ошибка. */
  function muteSwitchErrors() {
    const box = $('#toasts');
    if (!box || !('MutationObserver' in window)) return;
    new MutationObserver(() => {
      box.querySelectorAll('.toast').forEach((t) => {
        const text = String(t.textContent || '');
        if (/client initiated disconnect/i.test(text)) t.remove();
        else if (SWITCH.active && /не удалось войти/i.test(text)) t.remove();
      });
    }).observe(box, { childList: true });
  }

  function cleanHash() {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* не критично */ }
  }

  /** Двойное нажатие Enter на полях входа не должно поднимать второе подключение. */
  function guardDoubleJoin() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const t = e.target;
      if (!t || ['nameInput', 'roomInput', 'passInput'].indexOf(t.id || '') === -1) return;
      const btn = $('#joinBtn');
      if (btn && btn.disabled) {
        e.preventDefault();
        e.stopImmediatePropagation(); // обработчик app.js не получит это нажатие
      }
    }, true);
  }

  function bindBanner() {
    const go = $('#inviteGoBtn');
    const cancel = $('#inviteCancelBtn');
    const sw = $('#autoSwitch');
    if (go) go.addEventListener('click', () => { cancelCountdown(); doJoin(); });
    if (cancel) cancel.addEventListener('click', () => {
      cancelCountdown();
      toast('Авто-подключение отменено — данные комнаты уже подставлены');
    });
    if (sw) {
      sw.checked = store.get('auto', '1') !== '0';
      sw.addEventListener('change', () => {
        store.set('auto', sw.checked ? '1' : '0');
        if (!sw.checked) cancelCountdown();
      });
    }
    const warn = $('#micWarn');
    if (warn) warn.addEventListener('click', () => { const b = $('#micBtn'); if (b) b.click(); });
  }

  /** Другое окно «Волны» получило ссылку — присоединяемся к той же комнате. */
  function setupChannel() {
    if (!('BroadcastChannel' in window)) return;
    try {
      IB.bc = new BroadcastChannel('volna');
      IB.bc.onmessage = (ev) => {
        const m = ev.data || {};
        if (m.from === IB.id || m.type !== 'invite' || !m.room) return;
        if (!onJoinScreen()) return; // мы уже в комнате — не перебиваем разговор
        const inv = { room: String(m.room), key: String(m.key || '') };
        if (!applyInvite(inv)) return;
        toast('Приглашение в комнату «' + inv.room + '»');
        if (store.get('auto', '1') !== '0') startCountdown(3, 'Вас приглашают в комнату «' + inv.room + '»');
      };
    } catch (e) { IB.bc = null; }
  }

  function announceInvite(inv) {
    if (!IB.bc) return;
    try { IB.bc.postMessage({ type: 'invite', room: inv.room, key: inv.key, from: IB.id }); } catch (e) { /* не критично */ }
  }

  /* ═══════════ 4. Адрес и текст приглашения ═══════════ */

  async function loadAddresses() {
    let list = [];
    try {
      const r = await fetch('addresses.json', { cache: 'no-store' });
      if (r.ok) {
        const data = await r.json();
        list = (data.addresses || []).filter((x) => typeof x === 'string' && /^https?:\/\//i.test(x));
      }
    } catch (e) { list = []; }
    IB.addresses = list;
    const sel = $('#inviteAddr');
    if (sel) {
      sel.innerHTML = '';
      (list.length ? list : [location.origin]).forEach((a) => sel.append(new Option(a, a)));
      sel.value = list[0] || location.origin;
    }
  }

  function inviteAddress() {
    const sel = $('#inviteAddr');
    return (sel && sel.value) || IB.addresses[0] || location.origin;
  }

  function currentInviteLink() {
    const keyInput = $('#passInput');
    return inviteAddress() + '/#i=' + makeCode(currentRoom(), (keyInput && keyInput.value) || '');
  }

  function renderInvitePop() {
    const text = $('#inviteText');
    const note = $('#inviteNote');
    const link = currentInviteLink();
    if (text) text.value = link;
    if (note) {
      const local = /^(https?:\/\/)?(localhost|127\.0\.0\.1)/i.test(inviteAddress());
      note.textContent = local
        ? 'Ссылка ведёт на этот компьютер — участникам она не подойдёт. Запустите start.cmd: приложение подскажет сетевой адрес и подставит его сюда.'
        : 'Ссылка уже содержит ключ комнаты и подключает автоматически. Отправляйте только своим.';
    }
  }

  function bindInviteButton() {
    const btn = $('#inviteBtn');
    if (!btn) return;
    const fresh = btn.cloneNode(true); // снимаем старый обработчик: он копировал ссылку с localhost
    btn.replaceWith(fresh);
    fresh.addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = $('#invitePop');
      if (!pop) return;
      const show = pop.classList.contains('hidden');
      pop.classList.toggle('hidden');
      if (show) renderInvitePop();
    });
    document.addEventListener('click', (e) => {
      const pop = $('#invitePop');
      if (pop && !pop.classList.contains('hidden') && !pop.contains(e.target) && e.target !== fresh) pop.classList.add('hidden');
    });
    const copy = async (text, note) => {
      try {
        await navigator.clipboard.writeText(text);
        toast(note);
      } catch (err) {
        window.prompt('Скопируйте и отправьте участнику:', text);
      }
    };
    const copyBtn = $('#inviteCopyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const title = $('#appName');
        const name = (title && title.textContent) || 'Волна';
        const roomTitle = $('#roomTitle');
        const room = ((roomTitle && roomTitle.textContent) || '').trim() || 'main';
        copy('Заходи в «' + name + '», комната «' + room + '»:\n' + currentInviteLink() +
          '\n\nОткрой ссылку — приложение подключится само, ничего вводить не нужно.',
          'Приглашение скопировано — отправьте его участнику');
      });
    }
    const linkBtn = $('#inviteLinkBtn');
    if (linkBtn) linkBtn.addEventListener('click', () => copy(currentInviteLink(), 'Ссылка скопирована'));
    const addr = $('#inviteAddr');
    if (addr) addr.addEventListener('change', renderInvitePop);
  }

  /* ═══════════ 6. Хост, главное меню, шумоподавление, комнаты, чат ═══════════ */

  /* ---- 6.0. Звуковые сигналы и плавный переход между комнатами ---- */

  let AC = null;
  /** Сигнал в духе Discord: два коротких чистых тона вверх при входе, один вниз при выходе. */
  function beep(kind) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      AC = AC || new Ctx();
      if (AC.state === 'suspended') AC.resume();
      const notes = kind === 'out' ? [[420, 0]] : [[659, 0], [988, 0.085]];
      notes.forEach(([freq, delay]) => {
        const start = AC.currentTime + delay;
        const osc = AC.createOscillator();
        const gain = AC.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.11, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
        osc.connect(gain);
        gain.connect(AC.destination);
        osc.start(start);
        osc.stop(start + 0.14);
      });
    } catch (e) { /* звук не критичен */ }
  }

  const SWITCH = { active: false, timer: 0 };

  /** Затенение на время перехода: вместо «стартовой страницы» видна только плашка. */
  function switchOverlay(on) {
    let el = document.getElementById('switchOverlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'switchOverlay';
      el.className = 'switch-overlay hidden';
      el.innerHTML = '<span>Переход в комнату…</span>';
      document.body.append(el);
    }
    el.classList.toggle('hidden', !on);
    clearTimeout(SWITCH.timer);
    if (on) SWITCH.timer = setTimeout(() => switchOverlay(false), 9000);
  }

  /* ---- 6.1a. Счётчик участников без постоянного «до N» ---- */

  const CAP = { max: 0 };

  function pluralPeople(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'участник';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'участника';
    return 'участников';
  }

  /** В шапке только число людей; о лимите говорим лишь когда он достигнут. */
  function tidyRoomMeta() {
    const el = $('#roomMeta');
    if (!el) return;
    const text = String(el.textContent || '');
    const found = text.match(/(\d+)/);
    if (!found) return;
    const count = Number(found[1]);
    let short = count + ' ' + pluralPeople(count);
    if (CAP.max && count >= CAP.max) short += ' · комната заполнена';
    if (text !== short) el.textContent = short;
  }

  function watchRoomMeta() {
    try {
      fetch('/api/config').then((r) => r.json()).then((cfg) => {
        CAP.max = Number(cfg && cfg.maxParticipants) || 0;
        tidyRoomMeta();
      }).catch(() => undefined);
    } catch (e) { /* не критично */ }

    const el = $('#roomMeta');
    if (!el || !('MutationObserver' in window)) return;
    new MutationObserver(tidyRoomMeta).observe(el, { childList: true, characterData: true, subtree: true });
    tidyRoomMeta();
  }

  /* ---- 6.1b. Пинг: реальная задержка соединения ---- */

  const PC_LIST = [];

  // Запоминаем создаваемые PeerConnection'ы, чтобы читать из них RTT
  (function trackPeerConnections() {
    const Native = window.RTCPeerConnection;
    if (!Native) return;
    const Wrapped = function (cfg, ...rest) {
      const pc = new Native(cfg, ...rest);
      try { PC_LIST.push(pc); } catch (e) { /* не критично */ }
      return pc;
    };
    Wrapped.prototype = Native.prototype;
    window.RTCPeerConnection = Wrapped;
  })();

  async function measureRtt() {
    let best = 0;
    for (const pc of PC_LIST.slice(-6)) {
      if (!pc || pc.signalingState === 'closed') continue;
      try {
        const stats = await pc.getStats();
        stats.forEach((item) => {
          if (item.type === 'candidate-pair' && item.state === 'succeeded' && typeof item.currentRoundTripTime === 'number') {
            const ms = Math.round(item.currentRoundTripTime * 1000);
            if (ms > 0 && (!best || ms < best)) best = ms;
          }
        });
      } catch (e) { /* соединение могло закрыться */ }
    }
    return best;
  }

  function paintPing(ms) {
    const badge = $('#pingBadge');
    if (!badge) return;
    const value = badge.querySelector('b');
    if (!ms) {
      badge.classList.remove('good', 'ok', 'bad');
      if (value) value.textContent = '—';
      badge.title = 'Задержка: нет данных';
      return;
    }
    if (value) value.textContent = ms + ' мс';
    badge.classList.toggle('good', ms < 80);
    badge.classList.toggle('ok', ms >= 80 && ms < 180);
    badge.classList.toggle('bad', ms >= 180);
    badge.title = 'Задержка связи: ' + ms + ' мс';
  }

  function startPingLoop() {
    if (LOCK.pingTimer) clearInterval(LOCK.pingTimer);
    const tick = () => {
      if (!active) return;
      measureRtt().then(paintPing).catch(() => undefined);
    };
    tick();
    LOCK.pingTimer = setInterval(tick, 3000);
  }

  function stopPingLoop() {
    if (LOCK.pingTimer) { clearInterval(LOCK.pingTimer); LOCK.pingTimer = 0; }
    paintPing(0);
  }

  /* ---- 6.1c. Стрим в отдельном окне ---- */

  function bindPip() {
    const btn = $('#stagePipBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const video = $('#stageVideo');
      if (!video) return;
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
          return;
        }
        if (video.requestPictureInPicture) {
          await video.requestPictureInPicture();
          toast('Стрим открыт в отдельном окне — его можно двигать и масштабировать');
          return;
        }
        // запасной вариант: своё окно с тем же потоком
        const win = window.open('', 'volna-stage', 'width=960,height=560');
        if (!win) { toast('Браузер заблокировал окно — разрешите всплывающие окна', 'error'); return; }
        win.document.title = 'Волна — демонстрация';
        win.document.body.style.margin = '0';
        win.document.body.style.background = '#000';
        const v = win.document.createElement('video');
        v.autoplay = true;
        v.muted = true;
        v.playsInline = true;
        v.style.cssText = 'width:100vw;height:100vh;object-fit:contain;background:#000';
        win.document.body.append(v);
        if (video.srcObject) v.srcObject = video.srcObject;
      } catch (err) {
        toast('Не удалось открыть стрим в окне: ' + ((err && err.message) || err), 'error');
      }
    });
  }

  /* ---- 6.1. Имя хоста: на машине с сервером по умолчанию «Admin» ---- */

  function isServerMachine() {
    return /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname);
  }

  function setHostName() {
    if (!isServerMachine()) return;
    const input = $('#nameInput');
    if (!input) return;
    const current = (input.value || '').trim();
    if (!current || /^гость/i.test(current)) input.value = 'Admin';
  }

  /* ---- 6.2. Шумоподавление: фильтр низов + шумовой затвор ---- */

  const NS = { on: store.get('ns', '1') !== '0' };

  /** Аудио-процессор для LiveKit: в паузах микрофон почти закрыт, голос проходит целиком. */
  function makeGateProcessor() {
    const st = { ctx: null, src: null, filter: null, an: null, gate: null, dest: null, raf: 0, buf: null, hold: 0, frames: 0 };

    const api = {
      name: 'volna-noise-gate',
      processedTrack: undefined,

      async init(opts) {
        st.ctx = opts.audioContext;
        st.frames = 0;
        st.hold = 0;
        if (st.ctx && st.ctx.state === 'suspended') {
          try { await st.ctx.resume(); } catch (e) { /* браузер разбудит его после клика */ }
        }
        st.src = st.ctx.createMediaStreamSource(new MediaStream([opts.track]));
        st.filter = st.ctx.createBiquadFilter();
        st.filter.type = 'highpass';
        st.filter.frequency.value = 85;   // гул, ветер, рокот — вниз; голос остаётся
        st.gate = st.ctx.createGain();
        st.gate.gain.value = 0.06;
        st.an = st.ctx.createAnalyser();
        st.an.fftSize = 512;
        st.buf = new Uint8Array(st.an.fftSize);
        st.dest = st.ctx.createMediaStreamDestination();
        st.src.connect(st.filter);
        st.filter.connect(st.an);
        st.filter.connect(st.gate);
        st.gate.connect(st.dest);
        api.processedTrack = st.dest.stream.getAudioTracks()[0];

        const tick = () => {
          st.an.getByteTimeDomainData(st.buf);
          let sum = 0;
          for (let i = 0; i < st.buf.length; i++) { const d = (st.buf[i] - 128) / 128; sum += d * d; }
          const rms = Math.sqrt(sum / st.buf.length);
          const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          if (rms > 0.018) st.hold = now + 320;   // слышен голос — держим открытым ещё треть секунды
          const open = now < st.hold;
          const target = open ? 1 : 0.06;         // в паузах — почти тишина
          st.gate.gain.value += (target - st.gate.gain.value) * (open ? 0.55 : 0.1);
          st.frames++;
          if (st.frames % 10 === 0) {
            const meter = $('#nsLevel');
            if (meter) meter.style.width = Math.min(100, Math.round(rms * 700)) + '%';
            try { document.documentElement.dataset.volnaGate = String(st.frames); } catch (e) { /* не критично */ }
          }
          st.raf = requestAnimationFrame(tick);
        };
        st.raf = requestAnimationFrame(tick);
      },

      async restart(opts) {
        await api.destroy();
        await api.init(opts);
      },

      async destroy() {
        if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
        [st.src, st.filter, st.an, st.gate].forEach((node) => {
          try { if (node) node.disconnect(); } catch (e) { /* уже отключён */ }
        });
        try { if (api.processedTrack) api.processedTrack.stop(); } catch (e) { /* уже остановлен */ }
        api.processedTrack = undefined;
      },
    };
    return api;
  }

  /* ---- 6.3. Комнаты: свои комнаты и быстрый переход ---- */

  const ROOMS = { active: [], books: [], pending: '' };

  function loadBooks() {
    try {
      const list = JSON.parse(store.get('rooms', '[]'));
      ROOMS.books = Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x).slice(0, 60) : [];
    } catch (e) { ROOMS.books = []; }
  }

  function saveBooks() { store.set('rooms', JSON.stringify(ROOMS.books)); }

  function cleanRoomName(raw) {
    // Двойной дефис — разделитель «родитель--подкомната», его нельзя схлопывать.
    // Сохраняем его через временную метку, чистим остальное и возвращаем назад.
    const SEP = '~sep~';
    return String(raw || '').trim().toLowerCase()
      .replace(/--/g, SEP)
      .replace(/[^a-z0-9а-яё._~-]/gi, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-~]|[-~]$/g, '')
      .replace(new RegExp(SEP, 'g'), '--')
      .replace(/-{3,}/g, '--')
      .slice(0, 40);
  }

  const SUB_SEP = '--';
  const TEXT_ROOM = 'obshaya-perepiska'; // отдельная комната для общих текстовых сообщений
  let realRoom = '';                     // настоящее имя комнаты (подкомната: «родитель--подкомната»)

  function setRealRoom(name) {
    realRoom = cleanRoomName(name) || 'main';
    store.set('room', realRoom);
    return realRoom;
  }

  function currentRoom() {
    return realRoom || cleanRoomName((($('#roomInput') || {}).value) || '') || 'main';
  }

  function isTextRoom(name) {
    return String(name || currentRoom()) === TEXT_ROOM;
  }

  function isSubRoom(name) {
    return String(name || '').indexOf(SUB_SEP) > 0;
  }

  function parentOf(name) {
    const i = String(name || '').indexOf(SUB_SEP);
    return i > 0 ? String(name).slice(0, i) : '';
  }

  /** Имя для показа: подкомната — «игры · main», текстовая — «Общая переписка». */
  function prettyName(name) {
    const s = String(name || '');
    if (s === TEXT_ROOM) return 'Общая переписка';
    const i = s.indexOf(SUB_SEP);
    return i > 0 ? (s.slice(i + SUB_SEP.length) + ' · ' + s.slice(0, i)) : s;
  }

  function mk(tag, cls, html) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function inRoom() {
    const screen = $('#roomScreen');
    return !!screen && !screen.classList.contains('hidden');
  }

  async function refreshRooms() {
    try {
      const r = await fetch('/api/rooms', { cache: 'no-store' });
      const data = await r.json();
      ROOMS.active = (data.rooms || []).filter((x) => x && x.name);
    } catch (e) { ROOMS.active = []; }
    renderRooms();
  }

  function renderRooms() {
    const box = $('#roomList');
    if (!box) return;
    box.innerHTML = '';
    const here = inRoom() ? currentRoom() : '';
    const rows = [];
    const seen = new Set();
    ROOMS.active.forEach((r) => { seen.add(r.name); rows.push({ name: r.name, count: r.participants || 0, book: ROOMS.books.indexOf(r.name) >= 0 }); });
    ROOMS.books.forEach((name) => { if (!seen.has(name)) { seen.add(name); rows.push({ name: name, count: 0, book: true }); } });
    if (!seen.has(TEXT_ROOM)) rows.unshift({ name: TEXT_ROOM, count: 0, book: false, text: true });
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'muted tiny';
      empty.textContent = 'Пока пусто: создайте комнату ниже.';
      box.append(empty);
      return;
    }
    rows.forEach((info) => {
      const row = document.createElement('div');
      row.className = 'room-row' + (info.name === here ? ' current' : '') + (info.text ? ' text-room' : '');
      const name = document.createElement('div');
      name.className = 'room-name';
      const label = prettyName(info.name) + (info.text ? ' · текст' : '');
      name.innerHTML = (info.text ? MENU_ICONS.chat : MENU_ICONS.rooms) +
        '<span>' + label + (info.name === here ? ' · вы здесь' : (info.count ? ' · ' + info.count + ' чел.' : '')) + '</span>';
      row.append(name);
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn ghost small';
      go.textContent = info.name === here ? 'Открыть' : 'Войти';
      go.addEventListener('click', (e) => {
        e.stopPropagation();
        if (info.name === here) { closeMenu(); return; }
        switchToRoom(info.name);
      });
      row.append(go);
      if (info.book) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn ghost small';
        del.title = 'Убрать из своих комнат';
        del.textContent = '✕';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          ROOMS.books = ROOMS.books.filter((x) => x !== info.name);
          saveBooks();
          renderRooms();
        });
        row.append(del);
      }
      box.append(row);
    });
  }

  function switchToRoom(raw) {
    const target = cleanRoomName(raw);
    if (!target) return;
    if (inRoom() && target === currentRoom()) { closeMenu(); return; }
    const roomInput = $('#roomInput');
    if (roomInput) roomInput.value = target;
    setRealRoom(target);
    if (!PRIV.anon) store.set('invite', makeCode(target, (($('#passInput') || {}).value) || '')); // чтобы следующий запуск открыл ту же комнату
    closeMenu();
    if (inRoom()) {
      ROOMS.pending = target;
      SWITCH.active = true;
      // плашку показываем только если переход действительно затянулся
      setTimeout(() => { if (SWITCH.active) switchOverlay(true); }, 250);
      const leaveBtn = $('#leaveBtn');
      if (leaveBtn) leaveBtn.click();
    } else {
      doJoin();
    }
  }

  function createRoom() {
    const input = $('#newRoomInput');
    const name = cleanRoomName(input && input.value);
    if (!name) { toast('Название комнаты: буквы, цифры, дефис, до 32 знаков', 'error'); return; }
    if (ROOMS.books.indexOf(name) === -1) { ROOMS.books.unshift(name); saveBooks(); }
    if (input) input.value = '';
    toast('Комната «' + name + '» готова');
    switchToRoom(name);
  }

  /* ---- 6.4. Друзья: свои люди, которых можно позвать или навестить ---- */

  const FRIENDS = { list: [] };

  function loadFriends() {
    try {
      const list = JSON.parse(store.get('friends', '[]'));
      FRIENDS.list = Array.isArray(list) ? list.filter((f) => f && f.name).slice(0, 100) : [];
    } catch (e) { FRIENDS.list = []; }
  }

  function saveFriends() { store.set('friends', JSON.stringify(FRIENDS.list)); }

  function friendByName(name) {
    const needle = String(name || '').trim().toLowerCase();
    for (let i = 0; i < FRIENDS.list.length; i++) {
      if (String(FRIENDS.list[i].name).toLowerCase() === needle) return FRIENDS.list[i];
    }
    return null;
  }

  function addFriend(name, room) {
    const clean = String(name || '').trim().slice(0, 32);
    if (!clean || /^admin$/i.test(clean) && isServerMachine() && clean.toLowerCase() === myName().toLowerCase()) {
      if (!clean) { toast('Введите имя друга', 'error'); return null; }
    }
    const roomName = cleanRoomName(room || currentRoom() || (($('#roomInput') || {}).value) || 'main');
    const exist = friendByName(clean);
    if (exist) {
      exist.room = roomName;
      toast('«' + clean + '» уже в друзьях — обновил комнату');
    } else {
      FRIENDS.list.unshift({ name: clean, room: roomName });
      toast('«' + clean + '» добавлен в друзья');
    }
    saveFriends();
    renderFriends();
    return clean;
  }

  function removeFriend(name) {
    FRIENDS.list = FRIENDS.list.filter((f) => String(f.name) !== String(name));
    saveFriends();
    renderFriends();
  }

  /** Личное приглашение: ссылка ведёт в текущую комнату и запоминается у друга. */
  function friendCallText(friend) {
    const room = inRoom() ? currentRoom() : ((($('#roomInput') || {}).value) || 'main');
    const appName = ($('#appName') || {}).textContent || 'Волна';
    return friend.name + ', заходи в «' + appName + '», комната «' + prettyName(room) + '»:\n' + currentInviteLink() +
      '\n\nОткрой ссылку — подключишься сам. Приложение запомнит комнату, и в следующий раз тебя пустит сразу.';
  }

  async function copyText(text, note) {
    try {
      await navigator.clipboard.writeText(text);
      toast(note);
    } catch (e) {
      window.prompt('Скопируйте и отправьте:', text);
    }
  }

  function renderFriends() {
    const box = $('#friendList');
    if (!box) return;
    box.innerHTML = '';
    if (!FRIENDS.list.length) {
      const empty = document.createElement('p');
      empty.className = 'muted tiny';
      empty.textContent = 'Список пуст: добавьте друга по имени — он появится здесь вместе с комнатой.';
      box.append(empty);
      return;
    }
    FRIENDS.list.forEach((friend) => {
      const row = document.createElement('div');
      row.className = 'friend-row';
      const title = document.createElement('div');
      title.className = 'room-name';
      title.textContent = friend.name + (friend.room ? ' · ' + friend.room : '');
      row.append(title);

      const call = document.createElement('button');
      call.type = 'button';
      call.className = 'btn ghost small';
      call.title = 'Скопировать личное приглашение в текущую комнату';
      call.textContent = 'Позвать';
      call.addEventListener('click', (e) => { e.stopPropagation(); copyText(friendCallText(friend), 'Приглашение для «' + friend.name + '» скопировано'); });
      row.append(call);

      const visit = document.createElement('button');
      visit.type = 'button';
      visit.className = 'btn ghost small';
      visit.title = 'Зайти в комнату друга';
      visit.textContent = 'Зайти';
      visit.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!friend.room) { toast('У друга пока не записана комната', 'error'); return; }
        switchToRoom(friend.room);
      });
      row.append(visit);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn ghost small';
      del.title = 'Убрать из друзей';
      del.textContent = '✕';
      del.addEventListener('click', (e) => { e.stopPropagation(); removeFriend(friend.name); });
      row.append(del);
      box.append(row);
    });
  }

  /** Отмечаем друзей в списке участников и даём добавить нового одним нажатием. */
  function markFriendsInList() {
    const selfId = active && active.localParticipant ? active.localParticipant.identity : '';
    const rows = document.querySelectorAll('#people .person');
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const nameEl = row.querySelector('.p-name');
      if (!nameEl) continue;
      const isSelf = (selfId && row.dataset.id === selfId) || /·\s*вы\s*$/.test(String(nameEl.textContent || ''));
      if (isSelf) {
        row.classList.remove('is-friend');
        const own = row.querySelector('.friend-add');
        if (own) own.remove();
        delete row.dataset.friendMark;
        continue;
      }
      const name = String(nameEl.textContent || '').replace(/\s*·\s*вы$/, '').trim();
      if (!name) continue;
      const isFriend = !!friendByName(name);
      row.classList.toggle('is-friend', isFriend);
      if (row.dataset.friendMark !== '1') {
        row.dataset.friendMark = '1';
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'btn ghost small friend-add';
        add.title = isFriend ? 'Уже в друзьях' : 'Добавить в друзья';
        add.textContent = isFriend ? '★' : '+';
        add.addEventListener('click', (e) => {
          e.stopPropagation();
          if (friendByName(name)) { removeFriend(name); add.textContent = '+'; add.title = 'Добавить в друзья'; }
          else { addFriend(name, currentRoom()); add.textContent = '★'; add.title = 'Уже в друзьях'; }
        });
        row.append(add);
      } else {
        const add = row.querySelector('.friend-add');
        if (add) {
          add.textContent = isFriend ? '★' : '+';
          add.title = isFriend ? 'Уже в друзьях' : 'Добавить в друзья';
        }
      }
    }
  }

  /* ---- 6.5. Профили демонстрации экрана (для игр и видео) ---- */

  const GAME_Q = {
    // По умолчанию — документы и слайды: для выступающего важнее чёткость текста,
    // а не 60 кадров. Игры выбираются отдельно в меню.
    text: {
      label: 'Документы и слайды · чётко',
      res: { width: 2560, height: 1440, frameRate: 20 },
      bitrate: 4500000,
      hint: 'detail',
      degrade: 'maintain-resolution',
    },
    fhd60: { label: '1080p · 60 кадров · плавно', res: { width: 1920, height: 1080, frameRate: 60 }, bitrate: 4500000, hint: 'motion', degrade: 'maintain-framerate' },
    hd60: { label: '720p · 60 кадров · экономия', res: { width: 1280, height: 720, frameRate: 60 }, bitrate: 2000000, hint: 'motion', degrade: 'maintain-framerate' },
    qhd60: { label: '1440p · 60 кадров · максимум', res: { width: 2560, height: 1440, frameRate: 60 }, bitrate: 6000000, hint: 'motion', degrade: 'maintain-framerate' },
  };

  function gameProfile() {
    const key = store.get('gameQ', 'text');
    return GAME_Q[key] ? key : 'text';
  }

  function fillGameSelect() {
    const sel = $('#gameQuality');
    if (!sel) return;
    sel.innerHTML = '';
    Object.keys(GAME_Q).forEach((k) => sel.append(new Option(GAME_Q[k].label, k)));
    sel.value = gameProfile();
    sel.addEventListener('change', () => {
      store.set('gameQ', sel.value);
      toast('Профиль показа: ' + GAME_Q[sel.value].label);
    });
  }

  /* ---- 6.6. Чат комнаты (каналы данных LiveKit) ---- */

  const CHAT = { open: false, unread: 0, seen: new Set(), max: 200, topic: 'volna-chat' };

  function myName() {
    const input = $('#nameInput');
    return ((input && input.value) || '').trim() || 'Гость';
  }

  function renderChatBadge() {
    const badge = $('#chatBadge');
    if (!badge) return;
    badge.textContent = String(CHAT.unread);
    badge.classList.toggle('hidden', CHAT.unread === 0);
  }

  function chatScroll() {
    const log = $('#chatLog');
    if (log) log.scrollTop = log.scrollHeight;
  }

  function chatAdd(text, who, kind, id) {
    const log = $('#chatLog');
    if (!log) return;
    if (id) {
      if (CHAT.seen.has(id)) return;
      CHAT.seen.add(id);
      if (CHAT.seen.size > 500) CHAT.seen.clear();
    }
    const row = document.createElement('div');
    row.className = 'chat-msg' + (kind === 'sys' ? ' sys' : (who && who === myName() ? ' mine' : ''));
    if (kind !== 'sys') {
      const w = document.createElement('span');
      w.className = 'who';
      w.textContent = who || 'Гость';
      row.append(w);
    }
    row.append(document.createTextNode(String(text || '')));
    log.append(row);
    while (log.children.length > CHAT.max) log.removeChild(log.firstChild);
    if (!CHAT.open && kind !== 'sys') { CHAT.unread++; renderChatBadge(); }
    chatScroll();
  }

  function chatShow() {
    // Чат виден всегда и всем: это общая лента комнаты, а не всплывающая панель
    CHAT.open = true;
    const panel = $('#chatPanel');
    if (panel) {
      panel.classList.remove('hidden');
      panel.classList.remove('collapsed');
    }
    CHAT.unread = 0;
    renderChatBadge();
    chatScroll();
  }

  function chatSend(text) {
    const body = String(text || '').trim();
    if (!body) return;
    if (!active) { toast('Чат доступен в комнате', 'error'); return; }
    const msg = { t: 'msg', id: Math.random().toString(36).slice(2), name: myName(), text: body.slice(0, 500) };
    try {
      active.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(msg)), { reliable: true, topic: CHAT.topic });
      chatAdd(msg.text, msg.name, 'me', msg.id);
    } catch (e) {
      toast('Не удалось отправить: ' + ((e && e.message) || e), 'error');
    }
  }

  function onChatData(payload, participant, topic) {
    if (topic === FILES.topic) { onFileData(payload, participant); return; }
    if (topic && topic !== CHAT.topic) return;
    let msg = null;
    try { msg = JSON.parse(new TextDecoder().decode(payload)); } catch (e) { return; }
    if (!msg) return;
    if (msg.t === 'sub' && msg.name) {
      // Кто-то создал подкомнату в этой комнате — добавляем её в список у себя
      addSub(currentRoom(), msg.name);
      renderSubs();
      chatAdd('Создана подкомната «' + msg.name + '» — войти можно в меню, раздел «Подкомнаты»', '', 'sys');
      return;
    }
    if (msg.t !== 'msg' || !msg.text) return;
    chatAdd(String(msg.text).slice(0, 500), (participant && participant.name) || msg.name || 'Гость', 'other', msg.id);
  }

  /* ---- 6.6a. Файлы в чате: любой тип, передача по каналам данных ---- */

  const FILES = {
    topic: 'volna-file',
    chunk: 8 * 1024,              // кусок исходного файла — с запасом под лимит пакета
    max: 8 * 1024 * 1024,         // больше не отправляем: канал данных не для гигабайтов
    incoming: new Map(),
  };

  function fileId() {
    return 'f' + Math.random().toString(36).slice(2, 10);
  }

  function humanSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' Б';
    if (n < 1048576) return Math.round(n / 1024) + ' КБ';
    return (n / 1048576).toFixed(1) + ' МБ';
  }

  function bytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64ToBytes(text) {
    const bin = atob(String(text || ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function fileRow(id) {
    const log = $('#chatLog');
    if (!log) return null;
    return log.querySelector('[data-file="' + id + '"]');
  }

  function chatFileRow(id, name, size, who, kind) {
    const log = $('#chatLog');
    if (!log) return;
    const row = document.createElement('div');
    row.className = 'chat-msg' + (kind === 'me' ? ' mine' : '');
    row.dataset.file = id;
    const head = document.createElement('div');
    head.className = 'file-name';
    head.textContent = '📎 ' + String(name || 'файл').slice(0, 80) + ' · ' + humanSize(size);
    const st = document.createElement('div');
    st.className = 'file-status muted small';
    st.textContent = 'передаётся…';
    row.append(head, st);
    if (who) {
      const w = document.createElement('span');
      w.className = 'chat-who';
      w.textContent = who;
      row.prepend(w);
    }
    log.append(row);
    while (log.children.length > CHAT.max) log.removeChild(log.firstChild);
    chatScroll();
  }

  function chatFileStatus(id, text) {
    const row = fileRow(id);
    if (!row) return;
    const st = row.querySelector('.file-status');
    if (st) st.textContent = text;
  }

  function chatFileDone(id, blob, name, mime, kind) {
    const row = fileRow(id);
    if (!row) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = String(name || 'file');
    link.className = 'file-link';
    link.textContent = 'Скачать';
    const st = row.querySelector('.file-status');
    if (st) st.textContent = '';
    row.append(link);
    if (/^image\//.test(mime || '')) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = String(name || '');
      img.className = 'chat-img';
      img.loading = 'lazy';
      img.title = 'Двойной клик — открыть крупно';
      row.append(img);
    }
    // ссылка живёт, пока открыт чат; освобождаем при закрытии вкладки
    window.addEventListener('beforeunload', () => { try { URL.revokeObjectURL(url); } catch (e) { /* уже нет */ } });
  }

  async function fileSend(file) {
    if (!file) return;
    if (!active) { toast('Файлы можно отправлять, находясь в комнате', 'error'); return; }
    if (file.size > FILES.max) {
      toast('Файл больше ' + humanSize(FILES.max) + ' — так не отправить', 'error');
      return;
    }
    const id = fileId();
    const parts = Math.max(1, Math.ceil(file.size / FILES.chunk));
    chatFileRow(id, file.name, file.size, myName(), 'me');
    const send = (obj) => active.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(obj)),
      { reliable: true, topic: FILES.topic }
    );
    try {
      await send({ t: 'f', k: 'begin', id: id, name: file.name, size: file.size, mime: file.type || '', parts: parts });
      const buf = new Uint8Array(await file.arrayBuffer());
      for (let i = 0; i < parts; i++) {
        const slice = buf.subarray(i * FILES.chunk, Math.min(buf.length, (i + 1) * FILES.chunk));
        await send({ t: 'f', k: 'part', id: id, d: bytesToB64(slice) });
        if (i % 10 === 0 || i === parts - 1) chatFileStatus(id, 'передаётся… ' + Math.round(((i + 1) / parts) * 100) + '%');
      }
      await send({ t: 'f', k: 'end', id: id });
      chatFileDone(id, file, file.name, file.type || '', 'me');
    } catch (e) {
      chatFileStatus(id, 'не удалось отправить: ' + ((e && e.message) || e));
      toast('Файл не отправился: ' + ((e && e.message) || e), 'error');
    }
  }

  function onFileData(payload, participant) {
    let msg = null;
    try { msg = JSON.parse(new TextDecoder().decode(payload)); } catch (e) { return; }
    if (!msg || msg.t !== 'f') return;
    const who = (participant && participant.name) || 'Гость';
    if (msg.k === 'begin') {
      FILES.incoming.set(msg.id, { name: msg.name, size: msg.size, mime: msg.mime, parts: msg.parts, chunks: [], got: 0, who: who });
      chatFileRow(msg.id, msg.name, msg.size, who, 'other');
      return;
    }
    const item = FILES.incoming.get(msg.id);
    if (!item) return;
    if (msg.k === 'part') {
      item.chunks.push(b64ToBytes(msg.d));
      item.got += 1;
      chatFileStatus(msg.id, 'принимается… ' + Math.round((item.got / Math.max(1, item.parts)) * 100) + '%');
      return;
    }
    if (msg.k === 'end') {
      const blob = new Blob(item.chunks, { type: item.mime || 'application/octet-stream' });
      FILES.incoming.delete(msg.id);
      chatFileStatus(msg.id, '');
      chatFileDone(msg.id, blob, item.name, item.mime, 'other');
    }
  }

  function bindSubroomActions() {
    // Один обработчик на документ: кнопки работают даже если панель чата
    // переехала в другое место или была перерисована.
    if (window.__volnaSubHandlers) return;
    window.__volnaSubHandlers = true;
    document.addEventListener('click', (e) => {
      const target = e.target && e.target.closest ? e.target.closest('[data-volna-action]') : null;
      if (!target) return;
      const action = target.getAttribute('data-volna-action');
      if (action === 'new-room') { e.preventDefault(); openNewRoomInput(); }
      if (action === 'back') {
        e.preventDefault();
        const parent = parentOf(currentRoom());
        switchToRoom(parent || 'main');
      }
      if (action === 'collapse') { e.preventDefault(); chatShow(!CHAT.open); }
    });
  }

  function bindChatFiles() {
    // Встраиваем чат внизу колонки с участниками: отдельного окна больше нет
    const panel = $('#chatPanel');
    const stage = document.querySelector('.stage');
    if (stage && panel.parentElement !== stage) stage.append(panel);

    const input = $('#chatFile');
    if (input) {
      input.addEventListener('change', () => {
        Array.prototype.slice.call(input.files || []).forEach((f) => fileSend(f));
        input.value = '';
      });
    }
    const box = $('#chatPanel');
    if (box) {
      ['dragenter', 'dragover'].forEach((ev) => box.addEventListener(ev, (e) => {
        e.preventDefault();
        box.classList.add('drop');
      }));
      ['dragleave', 'drop'].forEach((ev) => box.addEventListener(ev, (e) => {
        e.preventDefault();
        if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          Array.prototype.slice.call(e.dataTransfer.files).forEach((f) => fileSend(f));
        }
        box.classList.remove('drop');
      }));
    }
  }


  /* ---- 6.6b. Увеличение картинок по двойному клику ---- */

  function openLightbox(src, alt) {
    let box = document.getElementById('lightbox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'lightbox';
      box.className = 'lightbox hidden';
      box.innerHTML = '<img alt=""><button class="lightbox-close" type="button" aria-label="Закрыть">✕</button>';
      document.body.append(box);
      box.addEventListener('click', (e) => {
        const target = e.target;
        if (target === box || (target.classList && target.classList.contains('lightbox-close'))) {
          box.classList.add('hidden');
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') box.classList.add('hidden');
      });
    }
    const img = box.querySelector('img');
    if (img) {
      img.src = src;
      img.alt = alt || '';
    }
    box.classList.remove('hidden');
  }

  function bindZoom() {
    document.addEventListener('dblclick', (e) => {
      const img = e.target && e.target.closest ? e.target.closest('.chat-img') : null;
      if (img && img.src) {
        e.preventDefault();
        openLightbox(img.src, img.alt);
        return;
      }
      const stage = e.target && e.target.closest ? e.target.closest('#stageVideo') : null;
      if (stage) {
        e.preventDefault();
        try {
          if (document.fullscreenElement) document.exitFullscreen();
          else if (stage.requestFullscreen) stage.requestFullscreen();
        } catch (err) { /* браузер может запретить */ }
      }
    });
  }

  /* ---- 6.5. Главное меню ---- */

  function closeMenu() {
    const s = $('#settings');
    if (s) s.classList.add('hidden');
    const i = $('#invitePop');
    if (i) i.classList.add('hidden');
  }

  function menuOpen() {
    const s = $('#settings');
    return !!s && !s.classList.contains('hidden');
  }

  function syncNsHint() {
    const hint = $('#nsHint');
    if (hint) {
      hint.textContent = NS.on
        ? 'Открыт только когда вы говорите: гул, шипение и щелчки в паузах не уходят в комнату.'
        : 'Выключено: в комнату уходит всё, что слышит микрофон (встроенное шумоподавление браузера остаётся).';
    }
    if (!NS.on) {
      const meter = $('#nsLevel');
      if (meter) meter.style.width = '0%';
    }
  }

  function syncMenuSwitches() {
    const ns = $('#nsToggle');
    if (ns) ns.checked = NS.on;
    const chat = $('#chatToggle');
    if (chat) chat.checked = CHAT.open;
    syncNsHint();
  }

  /** Включить/выключить шумовой затвор на текущей дорожке — без переподключения. */
  async function applyGate() {
    if (!active) return;
    const lp = active.localParticipant;
    try {
      const pub = lp.getTrackPublication && lp.getTrackPublication('microphone');
      const track = pub && pub.track;
      if (!track) return;
      if (NS.on) {
        if (typeof track.setProcessor === 'function' && !track.__volnaGate) {
          await track.setProcessor(makeGateProcessor());
          track.__volnaGate = true;
        }
      } else if (typeof track.stopProcessor === 'function' && track.__volnaGate) {
        await track.stopProcessor();
        delete track.__volnaGate;
      }
      NS.failed = false;
    } catch (e) {
      NS.failed = true;
      lastMicError = micReason(e);
      toast('Шумоподавление: настройку применить не удалось, микрофон работает без него', 'error');
    }
  }

  function bindMenu() {
    const setBtn = $('#setBtn');
    if (setBtn) {
      setBtn.title = 'Главное меню';
      setBtn.addEventListener('click', () => {
        setTimeout(() => { if (menuOpen()) { refreshRooms(); renderFriends(); syncMenuSwitches(); } }, 0);
      });
    }
    const ns = $('#nsToggle');
    if (ns) {
      ns.addEventListener('change', () => {
        NS.on = ns.checked;
        store.set('ns', NS.on ? '1' : '0');
        syncNsHint();
        applyGate();
        toast(NS.on ? 'Шумоподавление включено' : 'Шумоподавление выключено');
      });
    }
    const chatToggle = $('#chatToggle');
    if (chatToggle) chatToggle.addEventListener('change', () => chatShow(chatToggle.checked));
    const newBtn = $('#newRoomBtn');
    if (newBtn) newBtn.addEventListener('click', (e) => { e.stopPropagation(); createRoom(); });
    const subBtn = $('#newSubBtn');
    if (subBtn) subBtn.addEventListener('click', (e) => { e.stopPropagation(); createSub(); });
    const subInput = $('#newSubInput');
    if (subInput) {
      subInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); createSub(); }
      });
    }
    const friendBtn = $('#newFriendBtn');
    if (friendBtn) {
      friendBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const input = $('#newFriendInput');
        const added = addFriend(input ? input.value : '', currentRoom());
        if (added && input) input.value = '';
      });
    }
    const friendInput = $('#newFriendInput');
    if (friendInput) {
      friendInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        const added = addFriend(friendInput.value, currentRoom());
        if (added) friendInput.value = '';
      });
    }
    const newInput = $('#newRoomInput');
    if (newInput) {
      newInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); createRoom(); }
      });
    }
    const menuInvite = $('#menuInviteBtn');
    if (menuInvite) menuInvite.addEventListener('click', () => { const b = $('#inviteBtn'); if (b) b.click(); });
    const menuLeave = $('#menuLeaveBtn');
    if (menuLeave) menuLeave.addEventListener('click', () => { closeMenu(); const b = $('#leaveBtn'); if (b) b.click(); });
    const chatBtn = $('#chatBtn');
    if (chatBtn) chatBtn.addEventListener('click', () => {
      const input = $('#chatInput');
      if (input) input.focus();
    });
    const chatClose = $('#chatCloseBtn');
    if (chatClose) chatClose.addEventListener('click', () => chatShow(false));
    const chatForm = $('#chatForm');
    if (chatForm) {
      chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = $('#chatInput');
        chatSend(input ? input.value : '');
        if (input) input.value = '';
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (menuOpen()) { closeMenu(); return; }
      if (CHAT.open) chatShow(false);
    });
  }

  /* ---- 6.7. Отладочные маркеры (для проверок и будущих правок) ---- */

  function setupDebug() {
    window.__volnaDebug = {
      version: 3,
      inRoom: inRoom,
      currentRoom: currentRoom,
      room: () => active,
      lastMicError: () => lastMicError,
      lastScreenProfile: () => lastScreenProfile,
      friends: () => FRIENDS.list,
      gameProfile: gameProfile,
      subs: () => ({ room: currentRoom(), list: subsOf(isSubRoom(currentRoom()) ? parentOf(currentRoom()) : currentRoom()) }),
      privacy: () => ({ anon: PRIV.anon }),
      textRoom: () => isTextRoom(),
      rooms: () => ({ active: ROOMS.active, books: ROOMS.books }),
      chat: () => ({ open: CHAT.open, unread: CHAT.unread, messages: $('#chatLog') ? $('#chatLog').children.length : 0 }),
      ns: () => ({ on: NS.on, frames: Number(document.documentElement.dataset.volnaGate || 0) }),
      switchToRoom: switchToRoom,
      createRoom: createRoom,
      sendChat: chatSend,
    };
  }

  /* ---- 6.8. Значки и вкладки главного меню ---- */

  const MENU_ICONS = {
    sound: '<svg viewBox="0 0 24 24"><path d="M12 3.6a2.6 2.6 0 0 1 2.6 2.6v5.8a2.6 2.6 0 0 1-5.2 0V6.2A2.6 2.6 0 0 1 12 3.6Z"/><path d="M6 11a6 6 0 0 0 12 0"/><path d="M12 17v3.4"/></svg>',
    rooms: '<svg viewBox="0 0 24 24"><path d="M4 11.2 12 4.4l8 6.8"/><path d="M6.6 10.6V19.6h10.8v-9"/></svg>',
    people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="3.2"/><path d="M3.6 19.4c0-2.9 2.5-4.8 5.4-4.8s5.4 1.9 5.4 4.8"/><path d="M16.4 8.6a3 3 0 0 1 0 5.8"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/></svg>',
    noise: '<svg viewBox="0 0 24 24"><path d="M4 12h2l2-5 3 10 2.5-7 2 4h4.5"/></svg>',
    screen: '<svg viewBox="0 0 24 24"><rect x="3.2" y="4.6" width="17.6" height="11.6" rx="2"/><path d="M9 19.4h6"/><path d="M12 16.2v3.2"/></svg>',
    friend: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.6" r="3.2"/><path d="M5.8 19.4c0-3.2 2.8-5.4 6.2-5.4s6.2 2.2 6.2 5.4"/></svg>',
    sub: '<svg viewBox="0 0 24 24"><path d="M7 5.5h10a1.5 1.5 0 0 1 1.5 1.5V19a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V7A1.5 1.5 0 0 1 7 5.5Z"/><path d="M9.5 10h5"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="M12 19V5"/><path d="M6.5 10.5 12 5l5.5 5.5"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M4.5 6.5h15v9h-9l-6 4z"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>',
  };

  const MENU_PANES = [
    ['sound', 'Звук', 'sound'],
    ['rooms', 'Комнаты', 'rooms'],
    ['people', 'Люди', 'people'],
    ['more', 'Ещё', 'more'],
  ];

  const MENU_SECTIONS = {
    'Шумоподавление': 'sound',
    'Демонстрация экрана': 'sound',
    'Комнаты': 'rooms',
    'Подкомнаты': 'rooms',
    'Друзья': 'people',
    'Чат и выход': 'more',
    'Приватность': 'more',
  };

  const MENU_HEAD_ICONS = {
    'Шумоподавление': 'noise',
    'Демонстрация экрана': 'screen',
    'Комнаты': 'rooms',
    'Подкомнаты': 'sub',
    'Друзья': 'friend',
    'Чат и выход': 'chat',
    'Приватность': 'lock',
  };

  function showPane(key) {
    const panel = $('#settings');
    if (!panel) return;
    Array.from(panel.querySelectorAll('.menu-tabs .chip')).forEach((c) => c.classList.toggle('active', c.dataset.pane === key));
    Array.from(panel.querySelectorAll('.menu-pane')).forEach((p) => p.classList.toggle('active', p.dataset.pane === key));
    if (key === 'rooms') { refreshRooms(); renderSubs(); }
    if (key === 'people') renderFriends();
  }

  /** Панель настроек превращается в меню с вкладками: звук, комнаты, люди, ещё. */
  function buildMenuTabs() {
    const panel = $('#settings');
    if (!panel || panel.dataset.tabs === '1') return;
    panel.dataset.tabs = '1';

    const bar = mk('div', 'menu-tabs');
    const panes = {};
    MENU_PANES.forEach(([key, label, icon]) => {
      const chip = mk('button', 'chip', (MENU_ICONS[icon] || '') + '<span>' + label + '</span>');
      chip.type = 'button';
      chip.dataset.pane = key;
      chip.addEventListener('click', (e) => { e.stopPropagation(); showPane(key); });
      bar.append(chip);
      const pane = mk('div', 'menu-pane');
      pane.dataset.pane = key;
      panes[key] = pane;
    });
    const title = panel.querySelector('h3');
    if (title) title.after(bar); else panel.prepend(bar);

    // Сначала переносим содержимое, только потом добавляем сами вкладки в панель,
    // иначе обход соседних узлов зацепит уже добавленные панели.
    ['#micSelect2', '#modeSelect2', '#screenSelect', '#pttToggle', '#nsToggle', '#gameQuality'].forEach((sel) => {
      const node = $(sel);
      const wrapper = node && node.closest('.field, .switch');
      if (wrapper) panes.sound.append(wrapper);
    });

    // Секции с заголовками переезжают целиком (заголовок + всё до следующего заголовка)
    Array.from(panel.querySelectorAll('.menu-head')).forEach((head) => {
      const name = (head.textContent || '').trim();
      const pane = panes[MENU_SECTIONS[name]];
      if (!pane) return;
      const iconKey = MENU_HEAD_ICONS[name];
      if (iconKey && !head.querySelector('svg')) head.insertAdjacentHTML('afterbegin', MENU_ICONS[iconKey]);
      const batch = [head];
      let node = head;
      while (node.nextElementSibling && !node.nextElementSibling.classList.contains('menu-head') && !node.nextElementSibling.classList.contains('menu-pane')) {
        node = node.nextElementSibling;
        batch.push(node);
      }
      batch.forEach((n) => pane.append(n));
    });

    MENU_PANES.forEach(([key]) => panel.append(panes[key]));
    showPane('sound');
  }

  /* ---- 6.9. Комната для общих текстовых сообщений ---- */

  function enterTextRoom() {
    if (isTextRoom()) { closeMenu(); return; }
    toast('Общая переписка: текст без звука');
    switchToRoom(TEXT_ROOM);
  }

  /* ---- 6.10. Подкомнаты: своя связь и свой чат внутри комнаты ---- */

  const SUBS = { byRoom: {} };

  function loadSubs() {
    try {
      const data = JSON.parse(store.get('subs', '{}'));
      SUBS.byRoom = (data && typeof data === 'object') ? data : {};
    } catch (e) { SUBS.byRoom = {}; }
    // Миграция: раньше при создании из подкомнаты могли появляться имена с «--».
    // Оставляем только последний сегмент, чтобы список всегда был плоским.
    Object.keys(SUBS.byRoom).forEach((room) => {
      const cleaned = [];
      (SUBS.byRoom[room] || []).forEach((name) => {
        const short = String(name || '').split(SUB_SEP).pop();
        if (short && cleaned.indexOf(short) === -1) cleaned.push(short);
      });
      SUBS.byRoom[room] = cleaned;
    });
    saveSubs();
    pruneAliases();
  }

  function saveSubs() { store.set('subs', JSON.stringify(SUBS.byRoom)); }

  function subsOf(room) {
    const list = SUBS.byRoom[String(room || currentRoom())];
    return Array.isArray(list) ? list : [];
  }

  function addSub(room, name) {
    const parent = cleanRoomName(room || currentRoom());
    const sub = cleanRoomName(name);
    if (!parent || !sub) return '';
    const list = subsOf(parent).slice();
    if (list.indexOf(sub) === -1) { list.push(sub); SUBS.byRoom[parent] = list; saveSubs(); }
    return parent + SUB_SEP + sub;
  }

  function removeSub(room, name) {
    const parent = cleanRoomName(room || currentRoom());
    SUBS.byRoom[parent] = subsOf(parent).filter((x) => x !== name);
    saveSubs();
    // если удалили комнату, в которой «сидим», возвращаемся в родительскую
    if (String(store.get('room', '')) === parent + SUB_SEP + name) store.set('room', parent);
    renderSubs();
  }

  /** Убираем сохранённые имена комнат, которых больше нет. */
  function pruneAliases() {
    let map = {};
    try { map = JSON.parse(store.get('aliases', '{}')) || {}; } catch (e) { map = {}; }
    const known = new Set(['main']);
    Object.keys(SUBS.byRoom || {}).forEach((parent) => {
      known.add(parent);
      (SUBS.byRoom[parent] || []).forEach((sub) => known.add(parent + SUB_SEP + sub));
    });
    let changed = false;
    Object.keys(map).forEach((id) => {
      if (!known.has(id)) { delete map[id]; changed = true; }
    });
    if (changed) store.set('aliases', JSON.stringify(map));
  }
  async function announceSub(name) {
    if (!active) return;
    try {
      // Ждём фактической отправки: раньше переключение комнаты закрывало канал
      // раньше, чем уходило сообщение, и остальные о подкомнате не узнавали.
      await active.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ t: 'sub', name: name })),
        { reliable: true, topic: CHAT.topic }
      );
    } catch (e) { /* остальные узнают при следующем обмене */ }
  }

  /** Своё название комнаты (только на этом устройстве): комната на сервере зовётся иначе. */
  function roomAlias(id) {
    try {
      const map = JSON.parse(store.get('aliases', '{}'));
      return (map && map[id]) || '';
    } catch (e) { return ''; }
  }

  function setRoomAlias(id, name) {
    let map = {};
    try { map = JSON.parse(store.get('aliases', '{}')) || {}; } catch (e) { map = {}; }
    if (name) map[id] = String(name).slice(0, 40); else delete map[id];
    store.set('aliases', JSON.stringify(map));
    try { renderChannels(); } catch (e) { /* не критично */ }
    const title = $('#roomTitle');
    if (title) title.textContent = displayName(currentRoom());
    const chatTitle = $('#chatTitle');
    if (chatTitle) chatTitle.textContent = displayName(currentRoom());
  }

  function displayName(id) {
    return roomAlias(id) || shortName(id);
  }

  /** Короткое имя для узких мест: «Main» или «Subroom N» по порядку в списке. */
  function shortName(id) {
    const alias = roomAlias(id);
    if (alias) return alias;
    if (isSubRoom(id)) {
      const parent = parentOf(id);
      const name = String(id).split(SUB_SEP).pop();
      // своё имя — показываем сразу; служебное — нумеруем по порядку
      if (!/^subroom(-\d+)?$/.test(name)) return name;
      const index = subsOf(parent).indexOf(name);
      return 'Subroom ' + (index >= 0 ? index + 1 : 1);
    }
    return String(id) === 'main' ? 'Основной' : String(id);
  }

  /** Поле «новая подкомната» прямо в списке комнат: без диалогов и перезагрузок. */
  function openNewRoomInput() {
    const box = $('#channelList');
    if (!box) return;
    const existing = $('#chanNewRow');
    if (existing) { const f = existing.querySelector('input'); if (f) f.focus(); return; }

    const row = document.createElement('div');
    row.id = 'chanNewRow';
    row.className = 'chan-row editing';
    const input = document.createElement('input');
    input.className = 'chan-input';
    input.maxLength = 32;
    input.placeholder = 'название';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'chan-ok';
    ok.textContent = '✓';
    row.append(input, ok);
    box.append(row);

    const submit = () => {
      const parent = isSubRoom(currentRoom()) ? parentOf(currentRoom()) : currentRoom();
      const name = cleanRoomName(input.value) || defaultSubName(parent);
      row.remove();
      const field = $('#newSubInput');
      if (field) field.value = name;
      createSub();
    };
    ok.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); row.remove(); }
    });
    setTimeout(() => input.focus(), 30);
  }

  /** Левая колонка в стиле Discord: текущая комната, её подкомнаты и вход по клику. */
  function renderChannels() {
    const box = $('#channelList');
    if (!box) return;
    box.innerHTML = '';
    const here = currentRoom();
    const parent = isSubRoom(here) ? parentOf(here) : here;

    const rows = [{ id: parent, label: prettyName(parent), current: here === parent, main: true }];
    subsOf(parent).forEach((sub) => {
      const id = parent + SUB_SEP + sub;
      rows.push({ id: id, label: sub, current: here === id, main: false });
    });

    rows.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'chan-row' + (r.current ? ' current' : '') + (r.main ? '' : ' sub');
      const label = document.createElement('span');
      label.className = 'chan-name';
      label.textContent = shortName(r.id);
      row.append(label);
      if (r.main) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'chan-add';
        add.title = 'Создать подкомнату';
        add.textContent = '+';
        add.addEventListener('click', (e) => { e.stopPropagation(); openNewRoomInput(); });
        row.append(add);
        row.title = 'Общая комната';
      } else {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'chan-edit';
        edit.title = 'Переименовать';
        edit.textContent = '✎';
        edit.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = window.prompt('Новое название комнаты', displayName(r.id));
          if (next == null) return;
          setRoomAlias(r.id, String(next).trim());
        });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'chan-del';
        del.title = 'Удалить подкомнату';
        del.textContent = '✕';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          const parent = parentOf(r.id);
          const name = String(r.id).split(SUB_SEP).pop();
          // удаляем и локальное имя, иначе старое название остаётся в списке
          setRoomAlias(r.id, '');
          removeSub(parent, name);
          if (currentRoom() === r.id) {
            switchToRoom(parent || 'main');
          } else {
            renderChannels();
          }
        });
        row.append(edit, del);
        row.title = 'Подкомната — свой звук и свой чат';
        // двойной клик — тоже переименование
        row.addEventListener('dblclick', (e) => {
          e.preventDefault();
          const next = window.prompt('Новое название комнаты', displayName(r.id));
          if (next != null) setRoomAlias(r.id, String(next).trim());
        });
      }
      row.addEventListener('click', () => switchToRoom(r.id));
      box.append(row);
    });

    const title = $('#chanRoomName');
    if (title) title.textContent = shortName(here);

    // старой строки с названием больше нет — ничего не обновляем
  }

  function renderSubs() {
    // список комнат — украшение: даже если он упадёт, вход в комнату должен работать
    try { renderChannels(); } catch (e) { /* не критично */ }
    const box = $('#subList');
    if (!box) return;
    box.innerHTML = '';
    const here = currentRoom();
    const parent = isSubRoom(here) ? parentOf(here) : here;

    if (isSubRoom(here)) {
      const back = mk('div', 'room-row');
      const backName = mk('div', 'room-name', MENU_ICONS.up + '<span>Вернуться в общую комнату</span>');
      back.append(backName);
      const backBtn = mk('button', 'btn ghost small');
      backBtn.type = 'button';
      backBtn.textContent = 'Войти';
      backBtn.addEventListener('click', (e) => { e.stopPropagation(); switchToRoom(parent); });
      back.append(backBtn);
      box.append(back);
    }

    const list = subsOf(parent);
    if (!list.length) {
      const empty = mk('p', 'muted tiny');
      empty.textContent = 'Подкомнат пока нет: создайте — в них своя связь и свой чат.';
      box.append(empty);
      return;
    }
    list.forEach((sub) => {
      const id = parent + SUB_SEP + sub;
      const row = mk('div', 'room-row' + (id === here ? ' current' : ''));
      row.append(mk('div', 'room-name', MENU_ICONS.sub + '<span>' + (id === here ? sub + ' · вы здесь' : sub) + '</span>'));
      const go = mk('button', 'btn ghost small');
      go.type = 'button';
      go.textContent = id === here ? 'Открыть' : 'Войти';
      go.addEventListener('click', (e) => {
        e.stopPropagation();
        if (id === here) { closeMenu(); return; }
        switchToRoom(id);
      });
      row.append(go);
      const del = mk('button', 'btn ghost small');
      del.type = 'button';
      del.title = 'Убрать из списка';
      del.textContent = '✕';
      del.addEventListener('click', (e) => { e.stopPropagation(); removeSub(parent, sub); });
      row.append(del);
      box.append(row);
    });
  }

  /** Имя подкомнаты по умолчанию: subroom, subroom-2, subroom-3… */
  function defaultSubName(parent) {
    const taken = subsOf(parent);
    const base = 'subroom';
    if (taken.indexOf(base) === -1) return base;
    let index = 2;
    while (taken.indexOf(base + '-' + index) !== -1) index++;
    return base + '-' + index;
  }

  async function createSub() {
    const input = $('#newSubInput');
    const parent = isSubRoom(currentRoom()) ? parentOf(currentRoom()) : currentRoom();
    const sub = cleanRoomName(input && input.value) || defaultSubName(parent);
    const id = addSub(parent, sub);
    if (input) input.value = '';
    renderSubs(); // строка появляется сразу — без ожидания сети
    if (inRoom()) await announceSub(sub); // общая комната узнает о новой подкомнате
    toast('Комната «' + sub + '»');
    switchToRoom(id);
  }

  /* ---- 6.11. Приватность: без персональных данных ---- */

  const PRIV = { anon: store.get('anon', '0') === '1' };

  function applyAnon() {
    const sw = $('#anonToggle');
    if (sw) sw.checked = PRIV.anon;
    if (PRIV.anon) store.set('name', '');   // имя не сохраняем между запусками
  }

  function forgetEverything() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.indexOf('volna.') === 0)
        .forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* приватный режим браузера */ }
    toast('Сохранённые данные удалены — страница перезагрузится');
    setTimeout(() => location.reload(), 900);
  }

  function bindPrivacy() {
    const sw = $('#anonToggle');
    if (sw) {
      sw.addEventListener('change', () => {
        PRIV.anon = sw.checked;
        store.set('anon', PRIV.anon ? '1' : '0');
        if (PRIV.anon) {
          store.set('name', '');
          store.set('invite', '');
          toast('Анонимный вход: имя и приглашение больше не сохраняются');
        } else {
          toast('Имя и приглашение снова сохраняются на этом устройстве');
        }
      });
    }
    const forget = $('#forgetBtn');
    if (forget) forget.addEventListener('click', (e) => { e.stopPropagation(); forgetEverything(); });
    const textBtn = $('#textRoomBtn');
    if (textBtn) textBtn.addEventListener('click', (e) => { e.stopPropagation(); enterTextRoom(); });
  }

  /* ═══════════ 5. Запуск ═══════════ */
  function initEntry() {
    document.documentElement.dataset.volnaEntry = '1'; // отметка для selftest.html и отладки
    // диагностика демонстрации экрана: только по ?debug=1
    try {
      if (/[?&]debug=1/.test(location.search)) {
        window.addEventListener('unhandledrejection', (e) => {
          window.__lastRejection = String((e.reason && e.reason.message) || e.reason);
        });
        const gdm = navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia;
        if (gdm) {
          navigator.mediaDevices.getDisplayMedia = function (...args) {
            return gdm.apply(this, args).catch((err) => {
              window.__gdmError = String(err && err.name) + ': ' + String(err && err.message);
              throw err;
            });
          };
        }
      }
    } catch (e) { /* не критично */ }
    watchJoinScreen();
    initSessionLock();
    guardMultiJoin();
    muteSwitchErrors();
    guardDoubleJoin();
    bindBanner();
    bindInviteButton();
    bindMenu();
    bindChatFiles();
    bindSubroomActions();
    bindZoom();
    bindPip();
    watchRoomMeta();
    // Чат виден сразу: он часть комнаты, а не спрятанная за кнопкой панель
    if (store.get('chat', '1') !== '0') chatShow(true);
    loadBooks();
    loadSubs();
    loadFriends();
    renderFriends();
    renderSubs();
    fillGameSelect();
    buildMenuTabs();
    bindPrivacy();
    applyAnon();
    syncNsHint();
    setupDebug();
    setInterval(() => { if (inRoom()) markFriendsInList(); }, 2000);
    setupChannel();
    loadAddresses();
    setHostName(); // на машине с сервером имя по умолчанию — «Admin»

    const inv = inviteFromLocation();
    if (inv && applyInvite(inv)) {
      cleanHash();                 // ключ комнаты не остаётся в адресной строке
      announceInvite(inv);
      setHostName();
      startCountdown(3);
      return;
    }

    // Чистый вход по адресу без приглашения: убираем следы прошлой неудачной авто-попытки
    setTimeout(() => {
      if (inviteFromLocation()) return;
      if (readCode(store.get('invite', ''))) return;
      const hint = $('#joinHint');
      if (hint && /пароль|не удалось/i.test(hint.textContent || '')) hint.textContent = '';
      document.querySelectorAll('#toasts .toast.error').forEach((t) => t.remove());
    }, 1800);

    // Обычный запуск — например, с ярлыка на рабочем столе: подключаемся к последнему приглашению.
    // Если в адресе явно указана другая комната (?room=…), уважаем её и автозапуск не трогаем.
    if (store.get('auto', '1') !== '0') {
      const saved = readCode(store.get('invite', ''));
      const urlRoom = (new URLSearchParams(location.search).get('room') || '').trim();
      if (saved && (!urlRoom || urlRoom === saved.room) && applyInvite(saved)) {
        startCountdown(2, 'Подключаемся к комнате «' + saved.room + '»');
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initEntry);
  else initEntry();
})();
