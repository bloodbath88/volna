#!/usr/bin/env node
/**
 * «Волна» — перевод приложения в режим сервера (работа через интернет).
 *
 * Что делает:
 *   1) если указан сертификат — кладёт внешний сертификат (Let's Encrypt) как основной
 *   2) помечает домен и адреса в certs/meta.json, чтобы штатное обновление
 *      конфигурации не заменило его запасным самоподписанным
 *   3) переключает config.json в режим «сервер в интернете»
 *   4) при необходимости задаёт порт и управляет TURN
 *
 * Параметры:
 *   --domain voice.example.com    обязательный: ваш домен
 *   --cert /path/fullchain.pem    сертификат (можно не указывать — останется самоподписанный)
 *   --key  /path/privkey.pem      ключ сертификата
 *   --port 443                    порт веб-сервера (по умолчанию не меняется)
 *   --no-turn                     не включать TURN (нужно, когда приложение занимает порт 443)
 *
 * Примеры:
 *   node server/make-public.js --domain voice.example.com \
 *     --cert /etc/letsencrypt/live/voice.example.com/fullchain.pem \
 *     --key  /etc/letsencrypt/live/voice.example.com/privkey.pem --port 443 --no-turn
 *
 * Никаких секретов этот файл не содержит: всё берётся из config.json и указанных файлов.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const CFG_PATH = path.join(ROOT, 'config.json');
const CERT_DIR = path.join(ROOT, 'certs');
const CERT_CRT = path.join(CERT_DIR, 'server.crt');
const CERT_KEY = path.join(CERT_DIR, 'server.key');
const CERT_META = path.join(CERT_DIR, 'meta.json');

const argv = process.argv.slice(2);
const flagVal = (f) => {
  const i = argv.indexOf('--' + f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '';
};

const log = (m) => console.log('[Волна] ' + m);

/** Те же адреса, что использует setup.js — чтобы отметка совпала и сертификат не пересоздавался */
function findIps() {
  const out = [];
  const nics = os.networkInterfaces();
  for (const name of Object.keys(nics)) {
    for (const a of nics[name] || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue;
      out.push({ iface: name, ip: a.address });
    }
  }
  const rangeScore = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  const virtScore = (n) => (/virtual|vethernet|vmware|hyper-v|loopback|docker|wsl|tailscale|zerotier|radmin|hamachi/i.test(n) ? 2 : 0);
  out.sort((a, b) => (virtScore(a.iface) + rangeScore(a.ip)) - (virtScore(b.iface) + rangeScore(b.ip)));
  return out;
}

function main() {
  const domain = flagVal('domain');
  const certFile = flagVal('cert');
  const keyFile = flagVal('key');
  const portArg = flagVal('port');
  const noTurn = argv.includes('--no-turn');

  if (!domain) {
    console.error('Не указан домен. Пример:');
    console.error('  node server/make-public.js --domain voice.example.com --cert /etc/letsencrypt/live/voice.example.com/fullchain.pem --key /etc/letsencrypt/live/voice.example.com/privkey.pem');
    process.exit(1);
  }
  if (!fs.existsSync(CFG_PATH)) {
    console.error('Нет config.json. Сначала запустите приложение один раз (./start.sh) и повторите.');
    process.exit(1);
  }
  if (certFile && !keyFile) {
    console.error('Указан сертификат, но не указан ключ (--key).');
    process.exit(1);
  }
  if (!certFile && keyFile) {
    console.error('Указан ключ, но не указан сертификат (--cert).');
    process.exit(1);
  }

  const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
  if (!cfg.deploy) cfg.deploy = {};

  cfg.deploy.mode = 'public';
  cfg.deploy.domain = domain;

  let usedExternal = false;
  if (certFile && keyFile) {
    if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
      console.error('Не найден файл сертификата или ключа:');
      console.error('  сертификат: ' + certFile + '  ' + (fs.existsSync(certFile) ? 'ок' : 'НЕТ'));
      console.error('  ключ:       ' + keyFile + '  ' + (fs.existsSync(keyFile) ? 'ок' : 'НЕТ'));
      process.exit(1);
    }
    fs.mkdirSync(CERT_DIR, { recursive: true });
    fs.copyFileSync(certFile, CERT_CRT);
    fs.copyFileSync(keyFile, CERT_KEY);

    const ips = findIps();
    const primary = cfg.deploy.primaryIp || (ips[0] && ips[0].ip) || '';
    const allIps = Array.from(new Set([primary, ...ips.map((x) => x.ip)].filter(Boolean)));
    fs.writeFileSync(CERT_META, JSON.stringify({
      ips: allIps,
      domain: domain,
      created: new Date().toISOString(),
      source: 'external',
    }, null, 2) + '\n');
    usedExternal = true;
  }

  // TURN: включаем только по явному запросу и только с настоящим сертификатом
  if (!noTurn && usedExternal) {
    cfg.deploy.turnCertFile = certFile;
    cfg.deploy.turnKeyFile = keyFile;
  } else {
    cfg.deploy.turnCertFile = '';
    cfg.deploy.turnKeyFile = '';
  }

  if (portArg) {
    const n = Number(portArg);
    if (Number.isInteger(n) && n > 0 && n < 65536) {
      cfg.port = n;
    } else {
      log('Некорректный порт «' + portArg + '» — оставляю прежний.');
    }
  }

  fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2) + '\n');

  const port = cfg.port || 8443;
  const url = port === 443 ? 'https://' + domain : 'https://' + domain + ':' + port;

  log('Режим сервера включён.');
  log('Домен:               ' + domain);
  if (usedExternal) {
    log('Основной сертификат: ' + certFile);
  } else {
    log('Сертификат:          самоподписанный (внешний не указан)');
  }
  log('TURN:                ' + (cfg.deploy.turnCertFile ? 'включён (порт 443)' : 'выключен'));
  log('');
  if (port === 443 && cfg.deploy.turnCertFile) {
    log('ВНИМАНИЕ: порт 443 занят приложением и не может быть занят ещё и TURN.');
    log('Выберите одно: --port 8443 с TURN либо --no-turn с портом 443.');
  } else {
    log('Адрес для участников: ' + url);
  }
  log('');
  log('Дальше: node server/setup.js   (обновит конфигурацию голосового сервера)');
}

main();
