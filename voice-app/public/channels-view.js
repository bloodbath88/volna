/*
 * «Волна» — вид списка каналов как в Discord (фаза 2 паритета).
 * Не трогает entry.js: слушает перерисовку #channelList и оформляет готовые строки —
 * добавляет категории, иконки, живые счётчики участников и два раздела: текстовый канал
 * «Общая переписка» и голосовые комнаты. Обработчики родных кнопок (+/✎/✕) не теряются.
 * Отключается удалением этой строки из index.html.
 */
(function () {
  'use strict';

  const LIST_SEL = '#channelList';
  const TEXT_ROOM = 'obshaya-perepiska';
  const TEXT_LABEL = 'Общая переписка';
  const SUB_SEP = '--';
  const REFRESH_MS = 5000;
  const NATIVE_SEL = '.chan-row:not(.cv-text-row):not(.cv-voice-row)';

  let scheduled = false;
  let lastRows = -1;
  let counts = {};      // имя комнаты LiveKit -> участники
  let voiceMemory = {}; // id голосовой комнаты -> подпись (запоминаем родные строки)

  function dbg() { return window.__volnaDebug || null; }
  function callDbg(name) {
    const d = dbg();
    if (!d || typeof d[name] !== 'function') return undefined;
    try { return d[name](); } catch (e) { return undefined; }
  }

  function makeCat(text) {
    const div = document.createElement('div');
    div.className = 'cv-cat';
    div.textContent = text;
    return div;
  }

  /* ---- счётчики участников: /api/rooms -> {имя: число} ---- */

  async function refreshCounts() {
    try {
      const r = await fetch('/api/rooms', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      const next = {};
      (j.rooms || []).forEach((x) => { next[x.name] = x.participants; });
      counts = next;
    } catch (e) { /* сервер недоступен — показываем прошлое */ }
    updateCounts();
  }

  // точные id родных строк: первая — родительская комната, дальше подкомнаты
  function rowIds(rows) {
    const info = callDbg('subs');
    const parent = info && info.room;
    const list = (info && info.list) || [];
    if (!parent || rows.length !== list.length + 1) return null; // разметка устарела — не угадываем
    return rows.map((row, i) => (i === 0 ? parent : parent + SUB_SEP + list[i - 1]));
  }

  function isTextId(id) {
    return id === TEXT_ROOM || String(id).startsWith(TEXT_ROOM + SUB_SEP);
  }

  function classify(rows) {
    const ids = rowIds(rows);
    return rows.map((row, i) => {
      if (ids && ids[i]) return isTextId(ids[i]) ? 'text' : 'voice';
      const low = ((row.querySelector('.chan-name') || {}).textContent || '').trim().toLowerCase();
      return (low === 'общая переписка' || low.startsWith('обша') || low.startsWith('obshaya') || low === 'text') ? 'text' : 'voice';
    });
  }

  function setBadge(row, n) {
    let badge = row.querySelector('.cv-count');
    if (n > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'cv-count';
        const btn = row.querySelector('.chan-add, .chan-edit');
        row.insertBefore(badge, btn || null);
      }
      badge.textContent = n;
      row.setAttribute('data-cv-live', '1');
    } else {
      if (badge) badge.remove();
      row.removeAttribute('data-cv-live');
    }
  }

  function updateCounts() {
    const box = document.querySelector(LIST_SEL);
    if (!box) return;
    const rows = Array.from(box.querySelectorAll(NATIVE_SEL));
    const ids = rowIds(rows);
    if (ids) rows.forEach((row, i) => setBadge(row, counts[ids[i]] || 0));
    [box.querySelector('.cv-text-row'), box.querySelector('.cv-voice-row')].forEach((row) => {
      if (row) setBadge(row, counts[row.dataset.cvId] || 0);
    });
  }

  /* ---- свои строки: текстовый и голосовой каналы ---- */

  function makeRow(kind, id, label) {
    const row = document.createElement('div');
    row.className = 'chan-row cv-' + kind + '-row';
    row.dataset.cvId = id;
    if (callDbg('currentRoom') === id) row.classList.add('current');
    const ic = document.createElement('span');
    ic.className = 'cv-ic';
    ic.textContent = kind === 'text' ? '#' : '🔊';
    ic.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'chan-name';
    name.textContent = label;
    row.append(ic, name);
    setBadge(row, counts[id] || 0);
    row.addEventListener('click', () => {
      if (typeof (dbg() || {}).switchToRoom === 'function') {
        try { dbg().switchToRoom(id); } catch (e) { /* ничего */ }
      }
    });
    return row;
  }

  /* ---- категории, иконки, свои строки ---- */

  function decorate() {
    scheduled = false;
    const box = document.querySelector(LIST_SEL);
    if (!box) return;

    const rows = Array.from(box.querySelectorAll(NATIVE_SEL));
    if (!rows.length) return;

    const ids = rowIds(rows);
    const kinds = classify(rows);

    // иконки и подписи — при каждой перерисовке (строки создаются заново)
    rows.forEach((row, i) => {
      let ic = row.querySelector('.cv-ic');
      if (!ic) {
        ic = document.createElement('span');
        ic.setAttribute('aria-hidden', 'true');
        row.insertBefore(ic, row.firstChild);
      }
      ic.className = 'cv-ic';
      ic.textContent = kinds[i] === 'text' ? '#' : '🔊';
      const label = row.querySelector('.chan-name');
      // текстовую комнату называем как в приложении
      if (kinds[i] === 'text' && label && ids && ids[i] === TEXT_ROOM && label.textContent !== TEXT_LABEL) {
        label.textContent = TEXT_LABEL;
      }
      // запоминаем подписи голосовых комнат (пустые не запоминаем)
      if (kinds[i] === 'voice' && ids && ids[i]) {
        const lbl = label ? String(label.textContent) : '';
        if (lbl.trim()) voiceMemory[ids[i]] = lbl;
      }
    });

    // свои строки и категории — когда состав изменился ИЛИ их стёрла перерисовка entry.js
    if (rows.length !== lastRows || !box.querySelector('.cv-cat')) {
      lastRows = rows.length;
      box.querySelectorAll('.cv-cat').forEach((n) => n.remove());

      const nativeTextIdx = kinds.indexOf('text');
      const nativeVoiceIdx = kinds.indexOf('voice');

      // 1. текстовый канал сверху, если родной строки сейчас нет
      if (nativeTextIdx < 0) box.insertBefore(makeRow('text', TEXT_ROOM, TEXT_LABEL), box.firstChild);

      // 2. голосовой канал снизу, если мы в текстовой комнате (родных голосовых нет)
      //    rooms().active бывает пустым МАССИВОМ ([] — правдив в JS!), поэтому только строка
      if (nativeVoiceIdx < 0) {
        const raw = (callDbg('rooms') || {}).active;
        const activeId = typeof raw === 'string' ? raw.trim() : '';
        const voiceId = activeId && !isTextId(activeId) ? activeId : 'main';
        const label = voiceMemory[voiceId] || (voiceId === 'main' ? 'Основной' : String(voiceId).split(SUB_SEP).pop());
        box.append(makeRow('voice', voiceId, label));
      }

      // 3. категории над разделами
      const textRow = box.querySelector('.cv-text-row') || (nativeTextIdx >= 0 ? rows[nativeTextIdx] : null);
      if (textRow) box.insertBefore(makeCat('Текстовые каналы'), textRow);
      const voiceRow = box.querySelector('.cv-voice-row') || (nativeVoiceIdx >= 0 ? rows[nativeVoiceIdx] : null);
      if (voiceRow) box.insertBefore(makeCat('Голосовые каналы'), voiceRow);

      const oldTitle = document.querySelector('.chan-title');
      if (oldTitle) oldTitle.style.display = 'none';
    }

    updateCounts();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || setTimeout)(decorate);
  }

  function start() {
    const box = document.querySelector(LIST_SEL);
    if (!box) { setTimeout(start, 400); return; }
    decorate();
    refreshCounts();
    try {
      new MutationObserver(schedule).observe(box, { childList: true });
    } catch (e) { /* очень старый браузер */ }
    setInterval(refreshCounts, REFRESH_MS); // живые счётчики
    setInterval(schedule, 3000); // подстраховка перерисовок
    try { window.__cvDebug = { memory: () => voiceMemory, counts: () => counts }; } catch (e) { /* ничего */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
