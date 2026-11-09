/*
 * «Волна» — вид списка каналов как в Discord (фаза 2 паритета).
 * Не трогает entry.js: слушает перерисовку #channelList и оформляет готовые строки —
 * добавляет категории, иконки и живые счётчики участников (из /api/rooms).
 * Обработчики родных кнопок (+/✎/✕) не теряются — строки только украшаются.
 * Отключается удалением этой строки из index.html.
 */
(function () {
  'use strict';

  const LIST_SEL = '#channelList';
  const TEXT_HINTS = ['общая переписка', 'obshaya-perepiska', 'text', 'текст'];
  const SUB_SEP = '--';
  const REFRESH_MS = 5000;

  let scheduled = false;
  let lastRows = -1;
  let counts = {}; // имя комнаты LiveKit -> участники

  function isText(row) {
    const name = (row.querySelector('.chan-name') || {}).textContent || '';
    const low = String(name).trim().toLowerCase();
    return TEXT_HINTS.some((t) => low === t || low.startsWith(t));
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

  // id строк списка: первая — родительская, дальше подкомнаты в порядке subs()
  function rowIds(rows) {
    const dbg = window.__volnaDebug;
    if (!dbg || typeof dbg.subs !== 'function') return null;
    let info;
    try { info = dbg.subs(); } catch (e) { return null; }
    const parent = info && info.room;
    const list = (info && info.list) || [];
    if (!parent || rows.length !== list.length + 1) return null; // разметка устарела — не угадываем
    return rows.map((row, i) => (i === 0 ? parent : parent + SUB_SEP + list[i - 1]));
  }

  function updateCounts() {
    const box = document.querySelector(LIST_SEL);
    if (!box) return;
    const rows = Array.from(box.querySelectorAll('.chan-row'));
    const ids = rowIds(rows);
    if (!ids) return;
    rows.forEach((row, i) => {
      const n = counts[ids[i]] || 0;
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
    });
  }

  /* ---- категории и иконки ---- */

  function decorate() {
    scheduled = false;
    const box = document.querySelector(LIST_SEL);
    if (!box) return;

    const rows = Array.from(box.querySelectorAll('.chan-row'));
    if (!rows.length) return;

    // иконки — при каждой перерисовке (строки создаются заново)
    rows.forEach((row) => {
      if (row.querySelector('.cv-ic')) return;
      const ic = document.createElement('span');
      ic.className = 'cv-ic';
      ic.textContent = isText(row) ? '#' : '🔊';
      ic.setAttribute('aria-hidden', 'true');
      row.insertBefore(ic, row.firstChild);
    });

    // категории — когда состав изменился ИЛИ их стёрла перерисовка entry.js (она чистит весь список)
    if (rows.length !== lastRows || !box.querySelector('.cv-cat')) {
      lastRows = rows.length;
      box.querySelectorAll('.cv-cat').forEach((n) => n.remove());

      const text = [];
      const voice = [];
      rows.forEach((row) => (isText(row) ? text : voice).push(row));

      if (text.length) box.insertBefore(makeCat('Текстовые каналы'), text[0]);
      if (voice.length) box.insertBefore(makeCat(text.length ? 'Голосовые каналы' : 'Голосовые комнаты'), voice[0]);

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
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
