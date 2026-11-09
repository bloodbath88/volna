# План: роли «модератор / участник» — для ручной правки server.js

Файл `server/server.js` защищён платформенным фильтром от правок ИИ, поэтому изменения
вносит человек по этому плану. Все фрагменты готовы к копированию; номера строк — по
версии server.js от 09.11.2026 (файл ~150 строк).

## Идея

На сервере нет аккаунтов (замок — локальный, пароль комнаты один). Роли строим на
**двух ключах комнаты**: обычный (`roomPassword`) и модераторский (`adminPassword`).
Ключ, с которым человек вошёл, определяет его роль — сервер кладёт её в токен
(`metadata`), LiveKit раздаёт её всем участникам комнаты, интерфейс рисует корону 👑.
Ссылка-приглашение, скопированная модератором, автоматически делает модераторами
тех, кто по ней вошёл (ключ передаётся в ссылке) — отдельный UI не нужен.

## Шаг 1. config.json — одна строка (вручную)

Добавить рядом с `roomPassword`:

```json
"adminPassword": "придумайте-отдельный-ключ",
```

## Шаг 2. server.js — обработчик /api/token (строки 133–148)

**Было (133–135):**
```js
  if (cfg.roomPassword && !safeEqual(body.password || '', cfg.roomPassword)) {
    return res.status(403).json({ error: 'Неверный пароль комнаты' });
  }
```

**Стало:**
```js
  const isAdmin = !!cfg.adminPassword && safeEqual(body.password || '', cfg.adminPassword);
  if (!isAdmin && cfg.roomPassword && !safeEqual(body.password || '', cfg.roomPassword)) {
    return res.status(403).json({ error: 'Неверный пароль комнаты' });
  }
  const role = isAdmin ? 'moderator' : 'participant';
```

**Было (146–148):**
```js
    at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    const token = await at.toJwt();
    res.json({ token, url: 'wss://' + req.headers.host, room });
```

**Стало (роль в metadata токена + в ответе):**
```js
    at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    at.metadata = JSON.stringify({ role });
    const token = await at.toJwt();
    res.json({ token, url: 'wss://' + req.headers.host, room, role });
```

Перезапустить сервер после правки (`stop.ps1` → `start.ps1 -NoBrowser`).

## Шаг 3. entry.js — сохранить свою роль (редактируемый файл)

В месте обработки ответа `/api/token` (поиск `'/api/token'` в entry.js) после разбора
JSON добавить:

```js
if (data.role) store.set('role', String(data.role));
```

В `public/user-panel.js` рядом с именем показывать корону:

```js
if (store.get('role', '') === 'moderator') { /* span с 👑 перед именем */ }
```

В списке участников чужие роли видны из `participant.metadata` (LiveKit раздаёт её
автоматически): распарсить JSON и нарисовать 👑 у модераторов. Точка входа —
рендер `#people` в app.js (закрыт для ИИ) → сделать слоем поверх, как
`channels-view.js` (MutationObserver + перерисовка бейджей).

## Шаг 4. Права (что разрешено модератору)

Минимальный набор на грантах токена — без изменений выдачи:
- оба роли: `canPublish` (говорить), `canSubscribe` (слушать), `canPublishData` (чат);
- модератору дополнительно можно выдать `canAdmin` — понадобится для серверных
  действий (выгнать участника, закрыть комнату) через RoomService — отдельная задача
  на server.js (тот же файл, тот же порядок правки).

Список модераторских действий на будущее: выключить микрофон участника
(	SetRemoteMuted / RoomService.mutePublishedTrack), исключить из комнаты
(RemoveParticipant) — оба требуют серверного API-вызова, добавлять в server.js рядом
с `/api/token` как `POST /api/moderate` с проверкой `role === 'moderator'` по токену.

## Шаг 5. Проверка (добавить в tests/test_volna.py)

```python
def t14_role():
    """T14 роль модератора в токене"""
    body = '{"name":"qa","room":"main","password":"<adminPassword из config>"}'
    # POST /api/token → JSON должен содержать "role":"moderator"
```

До правки server.js тест пропускается (пропускать, если `adminPassword` нет в конфиге).

## Порядок применения

1. config.json: добавить `adminPassword` (вручную).
2. server.js: две правки выше (вручную), перезапуск.
3. entry.js + user-panel.js: роль в панели и списках (можно доверить ИИ).
4. tests: T14 + прогон всего сьюта.
5. Коммит и выгрузка.
