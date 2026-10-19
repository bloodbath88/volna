/**
 * «Волна» — клиент голосовой комнаты.
 * Голос и демонстрация экрана — через LiveKit (WebRTC), интерфейс — минимальный.
 */
'use strict';

(function () {
  const LK = window.LivekitClient;
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };

  if (!LK) {
    document.body.innerHTML = '<div style="font:16px system-ui;color:#fff;padding:28px">Не загрузилась библиотека livekit-client.<br>Проверьте файл public/vendor/livekit-client.umd.js</div>';
    return;
  }

  /* ══════════════ параметры качества ══════════════ */

  const MODES = {
    speech: { label: 'Речь · 24 кбит/с', preset: { maxBitrate: 24000 }, channelCount: 1, forceStereo: false },
    hq: { label: 'Высокая чёткость · 96 кбит/с', preset: { maxBitrate: 96000 }, channelCount: 1, forceStereo: false },
    stereo: { label: 'Музыка · стерео 128 кбит/с', preset: { maxBitrate: 128000 }, channelCount: 2, forceStereo: true },
  };

  const SCREEN_Q = {
    hd: { label: '720p · 30 к/с', res: { width: 1280, height: 720, frameRate: 30 }, bitrate: 2000000 },
    fhd: { label: '1080p · 30 к/с', res: { width: 1920, height: 1080, frameRate: 30 }, bitrate: 4500000 },
    fhd60: { label: '1080p · 60 к/с', res: { width: 1920, height: 1080, frameRate: 60 }, bitrate: 6500000 },
  };

  const ICO = {
    micOff: '<svg viewBox="0 0 24 24"><path d="M12 3.6a2.6 2.6 0 0 1 2.6 2.6v5.8a2.6 2.6 0 0 1-5.2 0V6.2A2.6 2.6 0 0 1 12 3.6Z"/><path d="M6 11a6 6 0 0 0 12 0"/><path d="M12 17v3.4"/><path d="M4.4 4.4 19.6 19.6"/></svg>',
    screen: '<svg viewBox="0 0 24 24"><rect x="3.2" y="4.6" width="17.6" height="11.6" rx="2"/><path d="M9 19.4h6"/><path d="M12 16.2v3.2"/></svg>',
  };

  const QLABEL = { excellent: 'отличная связь', good: 'хорошая связь', poor: 'слабая связь', unknown: 'подключается', lost: 'связь потеряна' };
  const QCLASS = { excellent: 'ok', good: 'ok', poor: 'warn', unknown: '', lost: 'bad' };

  /* ══════════════ состояние ══════════════ */

  const store = {
    get(k, d) { try { const v = localStorage.getItem('volna.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('volna.' + k, String(v)); } catch (e) { /* приватный режим */ } },
  };

  const S = {
    room: null, roomName: '', intentionalLeave: false, maxParticipants: 25,
    mode: store.get('mode', 'hq'), micId: store.get('micId', ''), screenQ: store.get('screenQ', 'fhd'),
    ptt: store.get('ptt', '0') === '1', pttHeld: false, pttPrevMic: false,
    deafOn: false, micBeforeDeaf: false, sharing: false,
    speakers: new Set(), quality: new Map(),
    volumes: (function () { try { return JSON.parse(store.get('volumes', '{}')) || {}; } catch (e) { return {}; } })(),
    audioEls: new Map(), screenTracks: new Map(), stageIdentity: null,
    rows: new Map(), tiles: new Map(),
    micTest: { stream: null, ctx: null, raf: 0 },
  };

  /* ══════════════ мелкие помощники ══════════════ */

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function hueOf(identity) {
    let h = 0;
    const s = String(identity || 'x');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }

  function initials(name) {
    const s = String(name || '?').trim();
    return s ? s[0].toUpperCase() : '?';
  }

  function toast(msg, kind) {
    const box = $('#toasts');
    const t = el('div', 'toast' + (kind === 'error' ? ' error' : ''));
    t.textContent = msg;
    box.append(t);
    setTimeout(() => t.remove(), 5200);
  }

  function volFor(name) {
    const v = S.volumes[name];
    return typeof v === 'number' ? Math.min(1, Math.max(0, v)) : 1;
  }

  function setVol(name, v) {
    S.volumes[name] = Math.min(1, Math.max(0, v));
    store.set('volumes', JSON.stringify(S.volumes));
    applyVolumes();
  }

  /* ══════════════ звук: подключение удалённых дорожек ══════════════ */

  function attachAudio(track, p) {
    const a = track.attach();
    a.autoplay = true;
    $('#remoteAudio').append(a);
    const list = S.audioEls.get(p.identity) || [];
    list.push(a);
    S.audioEls.set(p.identity, list);
    applyVolumes();
  }

  function detachAudio(track, p) {
    let els = [];
    try { els = track.detach() || []; } catch (e) { els = []; }
    els.forEach((n) => n.remove());
    const rest = (S.audioEls.get(p.identity) || []).filter((n) => els.indexOf(n) === -1);
    if (rest.length) S.audioEls.set(p.identity, rest);
    else S.audioEls.delete(p.identity);
  }

  function applyVolumes() {
    S.audioEls.forEach((els, identity) => {
      const p = S.room ? S.room.remoteParticipants.get(identity) : null;
      const v = S.deafOn ? 0 : volFor(p ? p.name : '');
      els.forEach((node) => {
        try { node.muted = S.deafOn; node.volume = v; } catch (e) { /* не критично */ }
      });
    });
  }

  /* ══════════════ отрисовка ══════════════ */

  function pubFlags(p) {
    let mic = false, screen = false;
    p.trackPublications.forEach((pub) => {
      if (pub.source === LK.Track.Source.Microphone && !pub.isMuted) mic = true;
      if (pub.source === LK.Track.Source.ScreenShare && !pub.isMuted) screen = true;
    });
    return { mic, screen };
  }

  function participantList() {
    if (!S.room) return [];
    const parts = [S.room.localParticipant].concat(Array.from(S.room.remoteParticipants.values()));
    return parts.sort((a, b) => {
      if (a === S.room.localParticipant) return -1;
      if (b === S.room.localParticipant) return 1;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
    });
  }

  function updateTile(node, p) {
    const isLocal = S.room && p.identity === S.room.localParticipant.identity;
    node.style.setProperty('--h', hueOf(p.identity));
    node.classList.toggle('speaking', S.speakers.has(p.identity));

    const av = $('.avatar', node);
    if (av.textContent !== initials(p.name)) av.textContent = initials(p.name);
    const nameEl = $('.t-name', node);
    const label = (p.name || 'Гость') + (isLocal ? ' · вы' : '');
    if (nameEl.textContent !== label) nameEl.textContent = label;

    const flags = pubFlags(p);
    const q = S.quality.get(p.identity);
    let html = '';
    if (!flags.mic) html += ICO.micOff;
    if (flags.screen) html += ICO.screen;
    if (!isLocal && q && QCLASS[q]) html += '<span class="dot ' + QCLASS[q] + '" title="' + (QLABEL[q] || '') + '"></span>';
    const flagEl = $('.t-flags', node);
    if (flagEl.innerHTML !== html) flagEl.innerHTML = html;
  }

  function updateRow(node, p) {
    const isLocal = S.room && p.identity === S.room.localParticipant.identity;
    node.style.setProperty('--h', hueOf(p.identity));
    node.classList.toggle('speaking', S.speakers.has(p.identity));

    const av = $('.p-av', node);
    if (av.textContent !== initials(p.name)) av.textContent = initials(p.name);
    const nameEl = $('.p-name', node);
    const label = (p.name || 'Гость') + (isLocal ? ' · вы' : '');
    if (nameEl.textContent !== label) nameEl.textContent = label;

    const flags = pubFlags(p);
    const q = S.quality.get(p.identity);
    let html = '';
    if (!isLocal && q && QLABEL[q]) html += (QLABEL[q] + ' ');
    if (!flags.mic) html += ICO.micOff;
    if (flags.screen) html += ICO.screen;
    const sub = $('.p-sub', node);
    if (sub.innerHTML !== html) sub.innerHTML = html;
  }

  function renderPeople() {
    const parts = participantList();
    const seen = new Set();
    const box = $('#people');

    parts.forEach((p) => {
      seen.add(p.identity);
      let row = S.rows.get(p.identity);
      if (!row) {
        row = buildRow(p);
        S.rows.set(p.identity, row);
      }
      updateRow(row, p);
      box.append(row);
    });

    S.rows.forEach((row, id) => {
      if (!seen.has(id)) { row.remove(); S.rows.delete(id); }
    });
  }

  function buildRow(p) {
    const row = el('div', 'person');
    row.dataset.id = p.identity;
    const av = el('div', 'p-av');
    const info = el('div', 'p-info');
    const name = el('div', 'p-name');
    const sub = el('div', 'p-sub');
    info.append(name, sub);
    row.append(av, info);

    const isLocal = S.room && p.identity === S.room.localParticipant.identity;
    if (!isLocal) {
      const vol = el('div', 'p-vol');
      const range = el('input');
      range.type = 'range';
      range.min = '0';
      range.max = '100';
      range.step = '5';
      range.value = String(Math.round(volFor(p.name) * 100));
      range.title = 'Громкость участника';
      range.addEventListener('input', () => setVol(p.name, Number(range.value) / 100));
      vol.append(range);
      row.append(vol);
    }
    return row;
  }

  function renderGrid() {
    const parts = participantList();
    const seen = new Set();
    const box = $('#grid');

    parts.forEach((p) => {
      seen.add(p.identity);
      let tile = S.tiles.get(p.identity);
      if (!tile) {
        tile = el('div', 'tile');
        tile.dataset.id = p.identity;
        tile.append(el('div', 'avatar'), el('div', 't-name'), el('div', 't-flags'));
        S.tiles.set(p.identity, tile);
      }
      updateTile(tile, p);
      box.append(tile);
    });

    S.tiles.forEach((tile, id) => {
      if (!seen.has(id)) { tile.remove(); S.tiles.delete(id); }
    });
  }

  function renderAll() {
    if (!S.room) return;
    renderGrid();
    renderPeople();
    const n = participantList().length;
    $('#countBadge').textContent = String(n);
    $('#roomMeta').textContent = n + ' ' + plural(n, 'участник', 'участника', 'участников') + ' · до ' + S.maxParticipants;
    renderControls();
  }

  /* ══════════════ кнопки управления ══════════════ */

  function setIcon(btn, idx) {
    const ics = btn.querySelectorAll('.ic');
    for (let i = 0; i < ics.length; i++) ics[i].classList.toggle('show', i === idx);
  }

  function micPub() {
    if (!S.room) return null;
    return S.room.localParticipant.getTrackPublication(LK.Track.Source.Microphone) || null;
  }

  function micLive() {
    const pub = micPub();
    return Boolean(pub && !pub.isMuted);
  }

  function renderControls() {
    const micBtn = $('#micBtn'), deafBtn = $('#deafBtn'), scrBtn = $('#screenBtn'), pttBtn = $('#pttBtn');
    const live = micLive();
    setIcon(micBtn, live ? 0 : 1);
    micBtn.classList.toggle('is-off', !live);
    micBtn.title = live ? 'Выключить микрофон — M' : 'Включить микрофон — M';
    setIcon(deafBtn, S.deafOn ? 1 : 0);
    deafBtn.classList.toggle('is-off', S.deafOn);
    deafBtn.title = S.deafOn ? 'Вернуть звук — D' : 'Оглушить — D';
    setIcon(scrBtn, S.sharing ? 1 : 0);
    scrBtn.classList.toggle('is-active', S.sharing);
    scrBtn.title = S.sharing ? 'Остановить демонстрацию' : 'Демонстрация экрана';
    pttBtn.classList.toggle('hidden', !S.ptt);
    pttBtn.classList.toggle('is-active', S.pttHeld);
  }

  async function toggleMic(force) {
    if (!S.room) return;
    const lp = S.room.localParticipant;
    const pub = micPub();
    const want = typeof force === 'boolean' ? force : !micLive();
    try {
      if (pub && pub.track) {
        if (want) await pub.track.unmute();
        else await pub.track.mute();
      } else if (want) {
        await lp.setMicrophoneEnabled(true, captureOpts(), publishOpts());
      }
    } catch (e) {
      toast('Микрофон: ' + e.message, 'error');
    }
    renderControls();
    renderAll();
  }

  function toggleDeafen() {
    if (!S.room) return;
    S.deafOn = !S.deafOn;
    if (S.deafOn) {
      S.micBeforeDeaf = micLive();
      if (S.micBeforeDeaf) toggleMic(false);
      toast('Звук отключён');
    } else {
      if (S.micBeforeDeaf) toggleMic(true);
      toast('Звук включён');
    }
    applyVolumes();
    renderControls();
    renderAll();
  }

  function pttApply(down) {
    if (!S.ptt || !S.room) return;
    if (down && !S.pttHeld) {
      S.pttHeld = true;
      S.pttPrevMic = micLive();
      if (!S.pttPrevMic) toggleMic(true);
    } else if (!down && S.pttHeld) {
      S.pttHeld = false;
      if (!S.pttPrevMic) toggleMic(false);
    }
    renderControls();
  }

  async function toggleScreen() {
    if (!S.room) return;
    const lp = S.room.localParticipant;
    const q = SCREEN_Q[S.screenQ] || SCREEN_Q.fhd;
    if (S.sharing) {
      try { await lp.setScreenShareEnabled(false); } catch (e) { /* уже остановлено */ }
      return;
    }
    try {
      await lp.setScreenShareEnabled(
        true,
        {
          audio: true,
          systemAudio: 'include',
          resolution: q.res,
          contentHint: 'detail',
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
        },
        { screenShareEncoding: { maxBitrate: q.bitrate, maxFramerate: q.res.frameRate }, simulcast: true }
      );
    } catch (e) {
      const name = e && e.name ? e.name : '';
      if (name !== 'NotAllowedError' && name !== 'AbortError') {
        toast('Не удалось начать демонстрацию: ' + (e.message || name), 'error');
      }
    }
  }

  /* ══════════════ сцена (демонстрация экрана) ══════════════ */

  function updateStage() {
    const wrap = $('#stageWrap');
    const grid = $('#grid');
    const video = $('#stageVideo');
    let id = S.stageIdentity;
    if (!id || !S.screenTracks.get(id)) {
      id = S.screenTracks.keys().next().done ? null : S.screenTracks.keys().next().value;
      S.stageIdentity = id;
    }

    if (id) {
      const track = S.screenTracks.get(id);
      if (video.__track !== track) {
        if (video.__track) { try { video.__track.detach(video); } catch (e) { /* уже отвязана */ } }
        track.attach(video);
        video.__track = track;
      }
      const p = S.room ? S.room.remoteParticipants.get(id) : null;
      const name = p ? p.name : (S.room && id === S.room.localParticipant.identity ? 'Вы' : 'Участник');
      $('#stageLabel').textContent = name + ' показывает экран';
      wrap.classList.remove('hidden');
      grid.classList.add('hidden');
      $('#stagePickBtn').classList.toggle('hidden', S.screenTracks.size < 2);
      if (S.screenTracks.size > 1) renderStagePicker();
    } else {
      if (video.__track) { try { video.__track.detach(video); } catch (e) { /* пусто */ } video.__track = null; }
      wrap.classList.add('hidden');
      grid.classList.remove('hidden');
      $('#stagePicker').classList.add('hidden');
    }
  }

  function renderStagePicker() {
    const box = $('#stagePicker');
    box.innerHTML = '';
    S.screenTracks.forEach((tr, identity) => {
      const p = S.room ? S.room.remoteParticipants.get(identity) : null;
      const b = el('button');
      b.type = 'button';
      b.textContent = (p ? p.name : (S.room && identity === S.room.localParticipant.identity ? 'Вы' : 'Участник')) + (identity === S.stageIdentity ? ' ✓' : '');
      b.addEventListener('click', () => {
        S.stageIdentity = identity;
        box.classList.add('hidden');
        updateStage();
      });
      box.append(b);
    });
  }

  /* ══════════════ подключение к комнате ══════════════ */

  function captureOpts() {
    const m = MODES[S.mode] || MODES.hq;
    const o = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: m.channelCount,
    };
    if (S.micId) o.deviceId = S.micId;
    return o;
  }

  function publishOpts() {
    const m = MODES[S.mode] || MODES.hq;
    return { audioPreset: m.preset, dtx: true, red: true, forceStereo: m.forceStereo };
  }

  function wireRoom(room) {
    room
      .on(LK.RoomEvent.ParticipantConnected, () => renderAll())
      .on(LK.RoomEvent.ParticipantDisconnected, (p) => {
        const els = S.audioEls.get(p.identity) || [];
        els.forEach((n) => n.remove());
        S.audioEls.delete(p.identity);
        S.screenTracks.delete(p.identity);
        if (S.stageIdentity === p.identity) S.stageIdentity = null;
        updateStage();
        renderAll();
      })
      .on(LK.RoomEvent.TrackSubscribed, (track, pub, p) => {
        const src = track.source;
        if (src === LK.Track.Source.ScreenShare) {
          S.screenTracks.set(p.identity, track);
          if (!S.stageIdentity) S.stageIdentity = p.identity;
          updateStage();
          toast(p.name + ' показывает экран');
        } else if (src === LK.Track.Source.Microphone || src === LK.Track.Source.ScreenShareAudio) {
          attachAudio(track, p);
        }
        renderAll();
      })
      .on(LK.RoomEvent.TrackUnsubscribed, (track, pub, p) => {
        const src = track.source;
        if (src === LK.Track.Source.ScreenShare) {
          S.screenTracks.delete(p.identity);
          if (S.stageIdentity === p.identity) S.stageIdentity = null;
          updateStage();
        } else if (src === LK.Track.Source.Microphone || src === LK.Track.Source.ScreenShareAudio) {
          detachAudio(track, p);
        }
        renderAll();
      })
      .on(LK.RoomEvent.TrackMuted, () => renderAll())
      .on(LK.RoomEvent.TrackUnmuted, () => renderAll())
      .on(LK.RoomEvent.LocalTrackPublished, (pub) => {
        const src = pub.track && pub.track.source;
        if (src === LK.Track.Source.ScreenShare || src === LK.Track.Source.ScreenShareAudio) {
          S.sharing = true;
          renderControls();
          renderAll();
        }
      })
      .on(LK.RoomEvent.LocalTrackUnpublished, (pub) => {
        const src = pub.source;
        if (src === LK.Track.Source.ScreenShare || src === LK.Track.Source.ScreenShareAudio) {
          S.sharing = false;
          S.screenTracks.delete(S.room.localParticipant.identity);
          if (S.stageIdentity === S.room.localParticipant.identity) S.stageIdentity = null;
          updateStage();
          renderControls();
          renderAll();
        }
      })
      .on(LK.RoomEvent.ActiveSpeakersChanged, (speakers) => {
        S.speakers = new Set(speakers.map((p) => p.identity));
        renderAll();
      })
      .on(LK.RoomEvent.ConnectionQualityChanged, (quality, p) => {
        S.quality.set(p.identity, quality);
        renderAll();
      })
      .on(LK.RoomEvent.AudioPlaybackStatusChanged, () => {
        showAudioBanner(!room.canPlaybackAudio);
      })
      .on(LK.RoomEvent.Reconnecting, () => toast('Переподключаемся…'))
      .on(LK.RoomEvent.Reconnected, () => toast('Связь восстановлена'))
      .on(LK.RoomEvent.LocalAudioSilenceDetected, () => {
        toast('Микрофон молчит — проверьте устройство или разрешения', 'error');
      })
      .on(LK.RoomEvent.Disconnected, () => {
        if (S.intentionalLeave) { S.intentionalLeave = false; return; }
        toast('Соединение с комнатой закрыто', 'error');
        leave();
      })
      .on(LK.RoomEvent.ConnectionStateChanged, (state) => setConn(state));
  }

  function setConn(state) {
    const dot = $('#connDot'), text = $('#connText');
    dot.className = 'dot';
    if (state === LK.ConnectionState.Connected) { dot.classList.add('ok'); text.textContent = ''; }
    else if (state === LK.ConnectionState.Reconnecting || state === LK.ConnectionState.SignalReconnecting) { dot.classList.add('warn'); text.textContent = 'восстановление связи…'; }
    else if (state === LK.ConnectionState.Disconnected) { dot.classList.add('bad'); text.textContent = 'нет связи'; }
  }

  function showAudioBanner(show) {
    $('#audioBanner').classList.toggle('hidden', !show);
  }

  async function join() {
    const name = $('#nameInput').value.trim() || 'Гость';
    const roomName = $('#roomInput').value.trim() || 'main';
    const password = $('#passInput').value;
    const btn = $('#joinBtn');

    stopMicTest();
    btn.disabled = true;
    $('#joinHint').textContent = 'Подключаемся…';
    S.intentionalLeave = false;

    try {
      const r = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, room: roomName, password: password }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || ('Сервер ответил ' + r.status));

      store.set('name', name);
      store.set('room', data.room || roomName);
      S.roomName = data.room || roomName;

      const m = MODES[S.mode] || MODES.hq;
      const room = new LK.Room({
        adaptiveStream: true,
        dynacast: true,
        disconnectOnPageLeave: true,
        audioCaptureDefaults: captureOpts(),
        videoCaptureDefaults: { resolution: { width: 1920, height: 1080, frameRate: 30 } },
        publishDefaults: { audioPreset: m.preset, dtx: true, red: true, forceStereo: m.forceStereo },
      });

      wireRoom(room);
      await room.connect(data.url, data.token);

      S.room = room;
      await room.localParticipant.setMicrophoneEnabled(true, captureOpts(), publishOpts());

      $('#joinScreen').classList.add('hidden');
      $('#roomScreen').classList.remove('hidden');
      $('#roomTitle').textContent = S.roomName;
      setConn(room.state);
      renderAll();
      if (!room.canPlaybackAudio) showAudioBanner(true);
      fillDevices();
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      $('#joinHint').textContent = msg;
      toast('Не удалось войти: ' + msg, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function leave() {
    S.intentionalLeave = true;
    try { if (S.room) S.room.disconnect(); } catch (e) { /* уже отключено */ }
    S.room = null;
    S.sharing = false;
    S.stageIdentity = null;
    S.speakers.clear();
    S.quality.clear();
    S.screenTracks.clear();
    S.audioEls.forEach((els) => els.forEach((n) => n.remove()));
    S.audioEls.clear();
    S.rows.forEach((r) => r.remove());
    S.rows.clear();
    S.tiles.forEach((t) => t.remove()); 
    S.tiles.clear();
    $('#people').innerHTML = '';
    $('#grid').innerHTML = '';
    updateStage();
    showAudioBanner(false);
    $('#roomScreen').classList.add('hidden');
    $('#joinScreen').classList.remove('hidden');
    $('#joinHint').textContent = '';
  }

  /* ══════════════ микрофон: устройства и проверка ══════════════ */

  async function fillDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const mics = all.filter((d) => d.kind === 'audioinput');
      [$('#micSelect'), $('#micSelect2')].forEach((sel) => {
        if (!sel) return;
        const keep = sel === $('#micSelect') ? (S.micId || sel.value) : (S.micId || sel.value);
        sel.innerHTML = '';
        const def = new Option('По умолчанию', '');
        sel.append(def);
        mics.forEach((d, i) => sel.append(new Option(d.label || ('Микрофон ' + (i + 1)), d.deviceId)));
        sel.value = Array.from(sel.options).some((o) => o.value === keep) ? keep : '';
      });
    } catch (e) { /* устройства недоступны до разрешения */ }
  }

  function stopMicTest() {
    const mt = S.micTest;
    if (mt.raf) { cancelAnimationFrame(mt.raf); mt.raf = 0; }
    if (mt.stream) { mt.stream.getTracks().forEach((t) => t.stop()); mt.stream = null; }
    if (mt.ctx) { try { mt.ctx.close(); } catch (e) { /* пусто */ } mt.ctx = null; }
    $('#micTest').classList.add('hidden');
    $('#micLevel').style.width = '0%';
    $('#micTestBtn').textContent = 'Проверить микрофон';
  }

  async function toggleMicTest() {
    if (S.micTest.stream) { stopMicTest(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: captureOpts() });
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      S.micTest.stream = stream;
      S.micTest.ctx = ctx;
      $('#micTest').classList.remove('hidden');
      $('#micTestBtn').textContent = 'Остановить проверку';
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const d = Math.abs(buf[i] - 128) / 128;
          if (d > peak) peak = d;
        }
        $('#micLevel').style.width = Math.min(100, Math.round(peak * 260)) + '%';
        S.micTest.raf = requestAnimationFrame(tick);
      };
      tick();
      fillDevices();
    } catch (e) {
      toast('Нет доступа к микрофону: ' + e.message, 'error');
    }
  }

  async function setMicDevice(id) {
    S.micId = id || '';
    store.set('micId', S.micId);
    syncDevices();
    if (S.room && micPub()) {
      try {
        const lp = S.room.localParticipant;
        await lp.setMicrophoneEnabled(false);
        await lp.setMicrophoneEnabled(true, captureOpts(), publishOpts());
        toast('Микрофон переключён');
      } catch (e) {
        toast('Не удалось переключить микрофон: ' + e.message, 'error');
      }
    }
  }

  function syncDevices() {
    [$('#micSelect'), $('#micSelect2')].forEach((sel) => { if (sel) sel.value = S.micId || ''; });
  }

  async function setMode(key) {
    if (!MODES[key]) key = 'hq';
    S.mode = key;
    store.set('mode', key);
    [$('#modeSelect'), $('#modeSelect2')].forEach((sel) => { if (sel) sel.value = key; });
    if (S.room && micPub()) {
      try {
        const lp = S.room.localParticipant;
        await lp.setMicrophoneEnabled(false);
        await lp.setMicrophoneEnabled(true, captureOpts(), publishOpts());
        toast('Режим звука: ' + MODES[key].label);
      } catch (e) {
        toast('Не удалось сменить режим: ' + e.message, 'error');
      }
    }
  }

  /* ══════════════ интерфейс входа ══════════════ */

  function fillSelects() {
    const modeSel = $('#modeSelect'), modeSel2 = $('#modeSelect2'), scrSel = $('#screenSelect');
    [modeSel, modeSel2].forEach((sel) => {
      sel.innerHTML = '';
      Object.keys(MODES).forEach((k) => sel.append(new Option(MODES[k].label, k)));
      sel.value = S.mode;
      sel.addEventListener('change', () => setMode(sel.value));
    });
    scrSel.innerHTML = '';
    Object.keys(SCREEN_Q).forEach((k) => scrSel.append(new Option(SCREEN_Q[k].label, k)));
    scrSel.value = S.screenQ;
    scrSel.addEventListener('change', () => { S.screenQ = scrSel.value; store.set('screenQ', S.screenQ); });

    $('#micSelect').addEventListener('change', () => setMicDevice($('#micSelect').value));
    $('#micSelect2').addEventListener('change', () => setMicDevice($('#micSelect2').value));

    const ptt = $('#pttToggle');
    ptt.checked = S.ptt;
    ptt.addEventListener('change', () => {
      S.ptt = ptt.checked;
      store.set('ptt', S.ptt ? '1' : '0');
      renderControls();
    });
  }

  async function loadServerInfo() {
    try {
      const r = await fetch('/api/config');
      const cfg = await r.json();
      S.maxParticipants = cfg.maxParticipants || 25;
      if (cfg.serverName) {
        $('#appName').textContent = cfg.serverName;
        document.title = cfg.serverName + ' — голосовая связь';
      }
      if (!cfg.passwordRequired) $('#passField').classList.add('hidden');
    } catch (e) { /* страница могла открыться без сервера */ }

    try {
      const r = await fetch('/api/rooms');
      const data = await r.json();
      const rooms = (data.rooms || []).filter((x) => x.name);
      if (rooms.length) {
        const box = el('div', 'muted small');
        box.style.marginTop = '2px';
        box.append(document.createTextNode('Сейчас активно: '));
        rooms.forEach((room) => {
          const b = el('button', 'btn ghost small');
          b.type = 'button';
          b.style.marginRight = '6px';
          b.style.marginTop = '4px';
          b.textContent = room.name + (room.participants ? ' · ' + room.participants : '');
          b.addEventListener('click', () => { $('#roomInput').value = room.name; });
          box.append(b);
        });
        $('#joinHint').after(box);
      }
    } catch (e) { /* список комнат — необязательный */ }
  }

  /* ══════════════ инициализация ══════════════ */

  function bindUi() {
    $('#joinBtn').addEventListener('click', join);
    $('#micTestBtn').addEventListener('click', toggleMicTest);
    $('#micBtn').addEventListener('click', () => toggleMic());
    $('#deafBtn').addEventListener('click', toggleDeafen);
    $('#screenBtn').addEventListener('click', toggleScreen);
    $('#leaveBtn').addEventListener('click', () => leave());
    $('#pttBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); pttApply(true); });
    $('#pttBtn').addEventListener('pointerup', () => pttApply(false));
    $('#pttBtn').addEventListener('pointerleave', () => pttApply(false));

    $('#setBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      $('#settings').classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      const s = $('#settings');
      if (!s.classList.contains('hidden') && !s.contains(e.target) && e.target !== $('#setBtn')) s.classList.add('hidden');
    });

    $('#inviteBtn').addEventListener('click', async () => {
      const url = location.origin + '/?room=' + encodeURIComponent(S.roomName || 'main');
      try {
        await navigator.clipboard.writeText(url);
        toast('Ссылка скопирована: ' + url);
      } catch (e) {
        window.prompt('Скопируйте ссылку и отправьте её коллегам:', url);
      }
    });

    $('#stageFullBtn').addEventListener('click', () => {
      const wrap = $('#stageWrap');
      if (document.fullscreenElement) document.exitFullscreen();
      else if (wrap.requestFullscreen) wrap.requestFullscreen();
    });

    $('#stagePickBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      $('#stagePicker').classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      const box = $('#stagePicker');
      if (!box.classList.contains('hidden') && !box.contains(e.target) && e.target !== $('#stagePickBtn')) box.classList.add('hidden');
    });

    $('#audioUnlockBtn').addEventListener('click', async () => {
      try { if (S.room) { await S.room.startAudio(); showAudioBanner(!S.room.canPlaybackAudio); } } catch (e) { /* пусто */ }
    });

    $('#roomInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    $('#nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    $('#passInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

    window.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = (e.key || '').toLowerCase();
      if (!S.room) return;
      if (k === 'm' && !e.repeat) { e.preventDefault(); toggleMic(); }
      else if (k === 'd' && !e.repeat) { e.preventDefault(); toggleDeafen(); }
      else if (k === 'v') { e.preventDefault(); pttApply(true); }
    });

    window.addEventListener('keyup', (e) => {
      if ((e.key || '').toLowerCase() === 'v') pttApply(false);
    });
  }

  function init() {
    $('#nameInput').value = store.get('name', '');
    const urlRoom = new URLSearchParams(location.search).get('room');
    $('#roomInput').value = urlRoom || store.get('room', 'main');

    if (!navigator.mediaDevices || !window.isSecureContext) {
      $('#browserHint').textContent = 'Для доступа к микрофону нужен HTTPS и современный браузер (Chrome, Edge, Firefox или Safari).';
    }

    fillSelects();
    bindUi();
    syncDevices();
    renderControls();
    loadServerInfo();
    fillDevices().catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
