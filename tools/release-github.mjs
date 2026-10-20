/**
 * Публикация релиза на GitHub (Node-версия): создаёт релиз и прикладывает архивы.
 *
 * Запуск (PowerShell):
 *   $env:GH_TOKEN='...'; $env:GH_REPO='owner/repo'; $env:GH_TAG='v1.2.0';
 *   $env:GH_NAME='Volna 1.2 — ...'; node tools/release-github.mjs
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN = (process.env.GH_TOKEN || '').trim();
const REPO = (process.env.GH_REPO || '').trim();
const TAG = (process.env.GH_TAG || 'v1.0.0').trim();
const NAME = (process.env.GH_NAME || 'Volna release').trim();
const ROOT = process.cwd();
const BODY_FILE = join(ROOT, 'deploy', 'release-notes.md');
const ASSETS = [
  ['volna-voice-app.zip', 'application/zip'],
  ['volna-voice-app-linux.tar.gz', 'application/gzip'],
];
const API = 'https://api.github.com';

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      authorization: 'Bearer ' + TOKEN,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'volna-release',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok && res.status !== 404) {
    throw new Error(method + ' ' + url + ' -> ' + res.status + ' ' + text.slice(0, 300));
  }
  return { status: res.status, data: text ? JSON.parse(text) : {} };
}

async function upload(url, file, mime) {
  const data = readFileSync(file);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + TOKEN,
      accept: 'application/vnd.github+json',
      'content-type': mime,
      'content-length': String(data.length),
      'user-agent': 'volna-release',
    },
    body: data,
  });
  const text = await res.text();
  if (!res.ok) throw new Error('upload ' + file + ' -> ' + res.status + ' ' + text.slice(0, 300));
  return JSON.parse(text);
}

async function main() {
  if (!TOKEN || !REPO.includes('/')) {
    console.error('Нужны GH_TOKEN и GH_REPO вида owner/repo');
    process.exit(2);
  }
  const body = existsSync(BODY_FILE) ? readFileSync(BODY_FILE, 'utf8') : '';

  const existing = await call('GET', API + '/repos/' + REPO + '/releases/tags/' + TAG);
  let release;
  if (existing.status === 200) {
    release = existing.data;
    console.log('Релиз ' + TAG + ' уже есть, обновляю описание');
    await call('PATCH', API + '/repos/' + REPO + '/releases/' + release.id, { body });
  } else {
    const created = await call('POST', API + '/repos/' + REPO + '/releases', {
      tag_name: TAG,
      name: NAME,
      body,
      draft: false,
      prerelease: false,
    });
    release = created.data;
    console.log('Релиз создан: ' + release.html_url);
  }

  const have = new Set((release.assets || []).map((a) => a.name));
  for (const [file, mime] of ASSETS) {
    const path = join(ROOT, file);
    if (!existsSync(path)) {
      console.log('Нет файла ' + file + ' — пропускаю');
      continue;
    }
    if (have.has(file)) {
      console.log(file + ' уже приложен');
      continue;
    }
    const size = (statSync(path).size / 1048576).toFixed(2);
    const asset = await upload(
      'https://uploads.github.com/repos/' + REPO + '/releases/' + release.id + '/assets?name=' + encodeURIComponent(file),
      path,
      mime
    );
    console.log('Загружен ' + file + ' (' + size + ' МБ) -> ' + (asset.browser_download_url || ''));
  }

  console.log('');
  console.log('Релиз: ' + release.html_url);
}

main().catch((e) => {
  console.error('ОШИБКА: ' + e.message);
  process.exit(1);
});
