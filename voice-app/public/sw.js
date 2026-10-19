/*
 * «Волна» — минимальный service worker.
 * Нужен только для того, чтобы Chrome и Edge считали приложение устанавливаемым
 * («Установить приложение» → иконка в меню «Пуск», отдельное окно).
 * Ничего не кэширует: голосовое приложение всегда должно брать свежую версию.
 */
'use strict';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', () => {
  /* обработчик нужен, чтобы браузер разрешил установку приложения;
     запросы не перехватываем — работаем строго через сеть */
});
