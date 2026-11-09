/*
 * «Волна» — панель пользователя внизу сайдбара, как в Discord (фаза 2 паритета).
 * Слой поверх интерфейса: аватар, имя текущего пользователя и кнопки, которые
 * только ДЕЛЕГИРУЮТ клики родным кнопкам приложения (#micBtn/#setBtn/#leaveBtn) —
 * состояния не дублируются, поэтому рассинхрона нет. Отключается удалением
 * строки <script src="user-panel.js"> из index.html.
 */
(function () {
  'use strict';

  const SIDEBAR_SEL = '#channels';
  const PEOPLE_SEL = '#people';
  const COLORS = ['#5865f2', '#3ba55c', '#faa81a', '#ed4245', '#eb459e', '#9b59b6'];
  const BUTTONS = [
    ['🎙', 'Микрофон', '#micBtn', ''],
    ['⚙', 'Настройки', '#setBtn', ''],
    ['📴', 'Завершить звонок', '#leaveBtn', 'danger'],
  ];

  let name = '';

  function selfRow() {
    const people = document.querySelector(PEOPLE_SEL);
    if (!people) return null;
    return Array.from(people.querySelectorAll('.person')).find((r) => /·\s*вы/.test(r.textContent || '')) || null;
  }

  function colorFor(n) {
    let h = 0;
    for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    return COLORS[h % COLORS.length];
  }

  function delegate(sel) {
    return function () {
      const b = document.querySelector(sel);
      if (b) b.click();
    };
  }

  function update() {
    const panel = document.querySelector('.cv-user');
    if (!panel) return;
    const row = selfRow();
    if (!row) return;
    const nameEl = row.querySelector('.p-name');
    const n = nameEl ? (nameEl.textContent || '').split('·')[0].trim() : '';
    if (n && n !== name) {
      name = n;
      const av = panel.querySelector('.cv-avatar');
      const pav = row.querySelector('.p-av');
      av.textContent = pav && pav.textContent ? pav.textContent : (n[0] || '?').toUpperCase();
      const h = parseFloat(row.style.getPropertyValue('--h'));
      av.style.background = isFinite(h) ? 'hsl(' + h + ', 45%, 45%)' : colorFor(n);
      panel.querySelector('.cv-user-name').textContent = n;
    }
  }

  function build(aside) {
    if (!aside || aside.querySelector('.cv-user')) return;
    const panel = document.createElement('div');
    panel.className = 'cv-user';

    const av = document.createElement('div');
    av.className = 'cv-avatar';
    av.textContent = '?';

    const nm = document.createElement('div');
    nm.className = 'cv-user-name';
    nm.textContent = '…';

    const btns = document.createElement('div');
    btns.className = 'cv-user-btns';
    BUTTONS.forEach(([ic, title, sel, cls]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cv-ub' + (cls ? ' ' + cls : '');
      b.title = title;
      b.textContent = ic;
      b.addEventListener('click', delegate(sel));
      btns.append(b);
    });

    panel.append(av, nm, btns);
    aside.append(panel);
    update();

    try {
      const people = document.querySelector(PEOPLE_SEL);
      if (people) new MutationObserver(update).observe(people, { childList: true, subtree: true, characterData: true });
    } catch (e) { /* старый браузер */ }
  }

  function start() {
    const aside = document.querySelector(SIDEBAR_SEL);
    if (aside) build(aside);
    // если entry.js пересоберёт сайдбар — восстанавливаем панель
    setInterval(() => {
      const a = document.querySelector(SIDEBAR_SEL);
      if (a) build(a);
    }, 3000);
    setInterval(update, 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
