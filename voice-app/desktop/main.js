/**
 * «Волна» — настольное приложение.
 *
 * Что делает:
 *   1) проверяет, запущен ли голосовой сервер (config.json → порт, /api/health);
 *   2) если не запущен — поднимает его тем же start.ps1, что и ярлык на рабочем столе;
 *   3) открывает окно приложения (без адресной строки и вкладок) сразу с приглашением,
 *      поэтому человек оказывается в комнате, не вводя ни адрес, ни пароль;
 *   4) принимает самоподписанный сертификат ТОЛЬКО для своего адреса — предупреждения
 *      браузера не будет, а для чужих сайтов проверка сертификата остаётся строгой;
 *   5) при выходе останавливает сервер, но только если сам его запустил.
 *
 * Запуск для проверки:  npx electron .   (из этой папки)
 * Обычный запуск:       ярлык «Волна» (создаётся install-desktop.cmd)
 */
'use strict';

const { app, BrowserWindow, Menu, shell, dialog, desktopCapturer, session } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, execFileSync } = require('child_process');

const DESKTOP_DIR = __dirname;
const ROOT = path.dirname(DESKTOP_DIR);           // папка приложения (там server/, public/, config.json)
const CFG_PATH = path.join(ROOT, 'config.json');
const ICON = path.join(ROOT, 'public', 'icon.ico');
const ROOM = process.env.VOLNA_ROOM || 'main';
// Работа через внешний сервер: файл remote.json рядом с этим приложением.
// { "url": "https://volna.is-cool.dev", "hash": "<код приглашения>" }
const REMOTE_PATH = path.join(DESKTOP_DIR, 'remote.json');
const REMOTE_ROAMING = process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming');
const REMOTE_USER_PATH = path.join(REMOTE_ROAMING, 'Volna', 'remote.json');
const REMOTE = (function () {
  // сначала личный файл в %APPDATA%\Volna (в репозиторий не попадает), затем рядом с приложением
  for (const file of [REMOTE_USER_PATH, REMOTE_PATH]) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && data.url) return data;
    } catch (e) { /* пробуем следующий */ }
  }
  return null;
})();

let mainWindow = null;
let serverStartedByUs = false;
let serverProc = null;
let appPort = 8443;
// Что показывать при демонстрации экрана: 'screen' — весь основной экран, либо id окна.
let shareSource = 'screen';
let shareSourceLabel = 'Весь экран';

/* ─────────── вспомогательное ─────────── */

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
  } catch (e) {
    return null;
  }
}

function inviteCode(room, key) {
  const json = JSON.stringify({ r: room, k: key || '' });
  return Buffer.from(json, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Проверка «сервер отвечает». Самоподписанный сертификат здесь ожидаем. */
function health(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = https.request(
      { host: '127.0.0.1', port: port, path: '/api/health', method: 'GET', rejectUnauthorized: false, timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve(res.statusCode === 200 && /"ok"/.test(body)));
      }
    );
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isOurAddress(url, port) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (u.port && Number(u.port) !== Number(port)) return false;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' ||
      host === (readConfig()?.deploy?.primaryIp || '').toLowerCase() ||
      (readConfig()?.deploy?.lanIps || []).indexOf(host) >= 0 ||
      host === (readConfig()?.deploy?.domain || '').toLowerCase();
  } catch (e) {
    return false;
  }
}

/* ─────────── демонстрация экрана ─────────── */

/**
 * В Electron показ экрана без этого обработчика не работает вообще.
 * По умолчанию отдаём весь экран; через меню можно выбрать конкретное окно (например, игру).
 */
function setupScreenShare() {
  try {
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
        let picked = null;
        if (shareSource && shareSource !== 'screen') {
          picked = sources.find((s) => s.id === shareSource) || null;
        }
        if (!picked) picked = sources.find((s) => s.id.startsWith('screen:')) || sources[0];
        if (!picked) { callback({}); return; }
        // audio: 'loopback' — системный звук (на Windows работает для экрана и окон)
        callback({ video: picked, audio: 'loopback' });
      } catch (e) {
        callback({});
      }
    });
  } catch (e) { /* старые версии Electron — обойдёмся без выбора источника */ }
}

/** Подменю «Что показывать»: список окон строится в момент открытия меню. */
function shareSubmenu() {
  return [
    {
      label: 'Весь экран',
      type: 'radio',
      checked: shareSource === 'screen',
      click: () => { shareSource = 'screen'; shareSourceLabel = 'Весь экран'; },
    },
    { type: 'separator' },
    {
      label: 'Выбрать окно…',
      click: async () => {
        const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
        const items = sources.filter((s) => s.name).map((s) => ({ label: s.name.slice(0, 60), click: () => { shareSource = s.id; shareSourceLabel = s.name; } }));
        if (!items.length) { dialog.showMessageBox(mainWindow, { type: 'info', message: 'Открытых окон не найдено' }); return; }
        Menu.buildFromTemplate(items).popup({ window: mainWindow });
      },
    },
    { type: 'separator' },
    { label: 'Сейчас: ' + shareSourceLabel, enabled: false },
  ];
}

/* ─────────── запуск сервера ─────────── */

async function ensureServer() {
  const cfg = readConfig();
  appPort = (cfg && cfg.port) || 8443;

  if (await health(appPort)) return true;   // сервер уже работает — трогать не нужно

  if (!cfg) {
    // Первый запуск: start.ps1 сам создаст конфигурацию, сертификат и скачает окружение.
    const ok = await runStartScript();
    return ok && (await waitForServer());
  }

  const ok = await runStartScript();
  return ok && (await waitForServer());
}

function runStartScript() {
  return new Promise((resolve) => {
    const script = path.join(ROOT, 'start.ps1');
    if (!fs.existsSync(script)) { resolve(false); return; }
    serverProc = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-NoBrowser', '-ParentPid', String(process.pid)],
      { cwd: ROOT, windowsHide: true, stdio: 'ignore' }
    );
    serverStartedByUs = true;
    serverProc.on('exit', () => { serverProc = null; });
    resolve(true);
  });
}

async function waitForServer(timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await health(appPort)) return true;
    await sleep(700);
  }
  return false;
}

function killTree(pid) {
  if (!pid || pid <= 0) return false;
  try {
    execFileSync('taskkill.exe', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch (e) {
    try { process.kill(pid); return true; } catch (e2) { return false; }
  }
}

/** Останавливает сервер, только если его запустили мы (при выходе приложения). */
function stopServerIfOurs() {
  if (!serverStartedByUs) return;
  serverStartedByUs = false;
  stopServer();
}

/** Остановить сервер и голосовое ядро: и при выходе, и по кнопке в меню. */
function stopServer() {
  const runDir = path.join(ROOT, 'run');
  for (const name of ['server.pid', 'livekit.pid']) {
    const pidFile = path.join(runDir, name);
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      killTree(pid);
    } catch (e) { /* файла нет */ }
    try { fs.unlinkSync(pidFile); } catch (e) { /* уже удалён */ }
  }
  if (serverProc && serverProc.pid) { killTree(serverProc.pid); serverProc = null; }
}

/* ─────────── окно ─────────── */

function appUrl(autoJoin) {
  // Внешний сервер (домен): локальный сервер не нужен вовсе
  if (REMOTE) {
    const base = String(REMOTE.url).replace(/\/$/, '') + '/';
    if (!autoJoin) return base;
    return REMOTE.hash ? base + '#i=' + REMOTE.hash : base;
  }
  const cfg = readConfig() || {};
  const base = 'https://localhost:' + appPort + '/';
  if (!autoJoin) return base;
  return base + '#i=' + inviteCode(ROOM, cfg.roomPassword || '');
}

/** Пока сервер поднимается, в окне видна простая заставка (без второго входа в комнату). */
const SPLASH = 'data:text/html;charset=utf-8,' + encodeURIComponent(
  '<body style="margin:0;background:#0b0d11;color:#8d97a8;font:15px system-ui;display:flex;' +
  'align-items:center;justify-content:center;height:100vh">Волна запускается…</body>'
);

function createWindow(targetUrl) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'Волна',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    backgroundColor: '#0b0d11',
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWindow.loadURL(targetUrl);

  // Ссылки «наружу» — в обычный браузер, а не в этом окне.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Уводить окно с нашего адреса нельзя (случайные переходы при перетаскивании ссылок).
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('https://localhost:' + appPort)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  const template = [
    {
      label: 'Волна',
      submenu: [
        { label: 'Войти в комнату заново', accelerator: 'CmdOrCtrl+R', click: () => { if (mainWindow) mainWindow.loadURL(appUrl(true)); } },
        { label: 'Что показывать при демонстрации экрана', submenu: shareSubmenu() },
        { label: 'Открыть папку приложения', click: () => shell.openPath(ROOT) },
        { label: 'Открыть папку журналов', click: () => shell.openPath(path.join(ROOT, 'run')) },
        { type: 'separator' },
        {
          // Обычно сервер останавливается сам при выходе. Эта кнопка — на случай,
          // если он остался от прошлого запуска; она же заменяет ярлык «остановить».
          label: REMOTE ? 'Закрыть приложение' : 'Остановить сервер',
          click: () => {
            const answer = dialog.showMessageBoxSync(mainWindow, {
              type: 'question',
              title: 'Волна',
              message: REMOTE ? 'Закрыть приложение?' : 'Остановить сервер «Волны»?',
              detail: REMOTE
                ? 'Окно закроется. Сервер работает на домене и продолжит работать.'
                : 'Окно приложения закроется. Запустить снова — ярлык «Волна».',
              buttons: ['Остановить', 'Отмена'],
              defaultId: 1,
              cancelId: 1,
            });
            if (answer !== 0) return;
            serverStartedByUs = true;   // останавливаем в любом случае: так решил человек
            stopServer();
            app.quit();
          },
        },
        { label: 'Выход', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Увеличить', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Уменьшить', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Сбросить масштаб', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Полный экран', accelerator: 'F11', role: 'togglefullscreen' },
        { label: 'Инструменты разработчика', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Помощь',
      submenu: [
        {
          label: 'Проверка браузера и связи',
          click: () => { if (mainWindow) mainWindow.loadURL('https://localhost:' + appPort + '/selftest.html'); },
        },
        {
          label: 'О программе',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Волна',
              message: 'Волна — голосовая связь и демонстрация экрана',
              detail:
                'Настольное приложение. Сервер и голосовое ядро работают на этом компьютере.\n\n' +
                'Адрес: https://localhost:' + appPort + '\n' +
                'Папка: ' + ROOT + '\n\n' +
                'Подсказка: показ экрана включается кнопкой с монитором в комнате, ' +
                'профиль качества для игр выбирается в главном меню (шестерёнка).',
              buttons: ['Понятно'],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ─────────── жизненный цикл ─────────── */

// Один экземпляр: второй запуск просто показывает уже открытое окно.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Единственное послабление по сертификату: свой адрес с самоподписанным сертификатом.
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    if (isOurAddress(url, appPort)) {
      event.preventDefault();
      callback(true);
    } else {
      callback(false);
    }
  });

  app.whenReady().then(async () => {
    app.setName('Волна');
    setupScreenShare();
    const langSwitch = ['ru'];
    try { app.commandLine.appendSwitch('lang', langSwitch[0]); } catch (e) { /* не критично */ }

    createWindow(SPLASH);             // окно открывается сразу с заставкой

    if (REMOTE) {
      // Домен: свой сервер не поднимаем, сразу грузим комнату на внешнем сервере
      buildMenu();
      if (mainWindow) mainWindow.loadURL(appUrl(true));
      return;
    }

    const ready = await ensureServer();
    if (!ready) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Волна',
        message: 'Не удалось запустить сервер приложения',
        detail:
          'Проверьте папку журналов: ' + path.join(ROOT, 'run') + '\n' +
          'Если это первый запуск — нужен интернет: приложение скачает Node.js и голосовое ядро.',
        buttons: ['Понятно'],
      });
      return;
    }

    buildMenu();
    if (mainWindow) mainWindow.loadURL(appUrl(true));   // окно входит в комнату само
  });

  app.on('window-all-closed', () => {
    stopServerIfOurs();
    app.quit();
  });

  app.on('before-quit', () => { stopServerIfOurs(); });
}
