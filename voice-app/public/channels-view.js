/*
 * «Волна» — вид списка каналов как в Discord (фаза 2 паритета).
 * Не трогает entry.js: слушает перерисовку #channelList и оформляет готовые строки —
 * добавляет категории и иконки, кнопки остаются родные (обработчики не теряются).
 * Отключается удалением этой строки из index.html.
 */
(function () {
  'use strict';

  const LIST_SEL = '#channelList';
  const TEXT_HINTS = ['общая переписка', 'obshaya-perepiska', 'text', 'текст'];
  let scheduled = false;
  let lastCount = -1;

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

  function decorate() {
    scheduled = false;
    const box = document.querySelector(LIST_SEL);
    if (!box) return;

    const rows = Array.from(box.querySelectorAll('.chan-row'));
    if (!rows.length) return;

    // если разметка не менялась — не трогаем DOM лишний раз
    if (rows.length === lastCount && box.querySelector('.cv-cat')) return;
    lastCount = rows.length;

    // 1. убираем прежние категории
    box.querySelectorAll('.cv-cat').forEach((n) => n.remove());

    // 2. делим строки на текстовые и голосовые
    const text = [];
    const voice = [];
    rows.forEach((row) => (isText(row) ? text : voice).push(row));

    // 3. иконки в строках (только если ещё нет)
    rows.forEach((row) => {
      if (row.querySelector('.cv-ic')) return;
      const ic = document.createElement('span');
      ic.className = 'cv-ic';
      ic.textContent = isText(row) ? '#' : '🔊';
      ic.setAttribute('aria-hidden', 'true');
      row.insertBefore(ic, row.firstChild);
    });

    // 4. категории: текстовые первыми, как в Discord
    if (text.length) {
      box.insertBefore(makeCat('Текстовые каналы'), text[0]);
    }
    if (voice.length) {
      box.insertBefore(makeCat(text.length ? 'Голосовые каналы' : 'Голосовые комнаты'), voice[0]);
    }

    // 5. шапка «Голосовые комнаты» из разметки больше не нужна
    const oldTitle = document.querySelector('.chan-title');
    if (oldTitle) oldTitle.style.display = 'none';
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    // entry.js перерисовывает список синхронно — ждём следующий кадр
    (window.requestAnimationFrame || setTimeout)(decorate);
  }

  function start() {
    const box = document.querySelector(LIST_SEL);
    if (!box) { setTimeout(start, 400); return; }
    decorate();
    try {
      const mo = new MutationObserver(schedule);
      mo.observe(box, { childList: true });
    } catch (e) { /* очень старый браузер */ }
    // подстраховка: раз в 3 секунды, если что-то перерисовалось мимо observer
    setInterval(schedule, 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
