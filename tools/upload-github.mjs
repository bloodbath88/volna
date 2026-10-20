/**
 * Публикация проекта на GitHub через API (Node-версия, без git).
 *
 * Зачем Node: антивирус на этой машине блокирует исходящие соединения Python,
 * а curl и node проходят.
 *
 * Запуск (PowerShell):
 *   $env:GH_TOKEN = '...'; $env:GH_REPO = 'owner/repo'; node tools/upload-github.mjs
 *
 * Правила отбора файлов те же, что были в deploy/upload-github.py:
 * секреты и машинные файлы в репозиторий не попадают.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const TOKEN = (process.env.GH_TOKEN || '').trim();
const REPO = (process.env.GH_REPO || '').trim();
const BRANCH = (process.env.GH_BRANCH || 'main').trim() || 'main';
const MESSAGE = (process.env.GH_MESSAGE || 'Volna: update').trim();
const ROOT = process.cwd();
const API = 'https://api.github.com';

const SKIP_DIRS = new Set(['node_modules', '.zwork', 'build', 'runtime', '.git', 'certs', 'run', 'tmp-certs', '__pycache__']);
const SKIP_NAMES = new Set([
  'config.json', 'livekit.yaml', 'addresses.json', 'livekit-server.exe',
  'volna_deploy_key', 'volna_deploy_key.pub', 'udp-mapping.txt', 'DOMAIN.md', 'turnserver.conf',
]);
const SKIP_EXT = ['.zip', '.tar.gz', '.log', '.pid', '.pem', '.key', '.pyc', '.tar'];

function collect(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full).replace(/\\/g, '/');
    const info = statSync(full);
    if (info.isDirectory()) {
      const base = name;
      if (SKIP_DIRS.has(base)) continue;
      if (base === 'node_modules' && rel.startsWith('voice-app/desktop')) continue;
      collect(full, out);
      continue;
    }
    if (SKIP_NAMES.has(name)) continue;
    if (SKIP_EXT.some((ext) => name.toLowerCase().endsWith(ext))) continue;
    if (rel.startsWith('deploy/od-')) continue;
    out.push({ rel, full, exec: /\.(sh|cmd)$/i.test(name) });
  }
  return out;
}

async function call(method, path, body) {
  const res = await fetch(API + path, {
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
  if (!res.ok) {
    throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + text.slice(0, 300));
  }
  return text ? JSON.parse(text) : {};
}

async function main() {
  if (!TOKEN || !REPO.includes('/')) {
    console.error('Нужны GH_TOKEN и GH_REPO вида owner/repo');
    process.exit(2);
  }

  console.log('1. Репозиторий ' + REPO);
  const repo = await call('GET', '/repos/' + REPO);
  const branch = repo.default_branch || BRANCH;
  console.log('   ' + repo.full_name + ', ветка ' + branch);

  const ref = await call('GET', '/repos/' + REPO + '/git/ref/heads/' + branch);
  const headSha = ref.object.sha;
  const headCommit = await call('GET', '/repos/' + REPO + '/git/commits/' + headSha);
  console.log('   база: ' + headSha.slice(0, 7));

  const files = collect();
  const totalBytes = files.reduce((sum, f) => sum + statSync(f.full).size, 0);
  console.log('2. Файлов: ' + files.length + ', ' + (totalBytes / 1048576).toFixed(2) + ' МБ');

  const tree = [];
  for (const file of files) {
    const blob = await call('POST', '/repos/' + REPO + '/git/blobs', {
      content: readFileSync(file.full).toString('base64'),
      encoding: 'base64',
    });
    tree.push({ path: file.rel, mode: file.exec ? '100755' : '100644', type: 'blob', sha: blob.sha });
  }

  const newTree = await call('POST', '/repos/' + REPO + '/git/trees', { tree, base_tree: headCommit.tree.sha });
  console.log('3. Дерево: ' + newTree.sha.slice(0, 7));

  const commit = await call('POST', '/repos/' + REPO + '/git/commits', {
    message: MESSAGE,
    tree: newTree.sha,
    parents: [headSha],
  });
  console.log('4. Коммит: ' + commit.sha.slice(0, 7));

  await call('PATCH', '/repos/' + REPO + '/git/refs/heads/' + branch, { sha: commit.sha, force: false });
  console.log('5. Ветка обновлена');

  const check = await call('GET', '/repos/' + REPO + '/git/trees/' + branch + '?recursive=1');
  const paths = (check.tree || []).filter((x) => x.type === 'blob').map((x) => x.path);
  const bad = paths.filter((p) => SKIP_NAMES.has(p.split('/').pop()));
  console.log('6. Файлов в репозитории: ' + paths.length + ', запрещённых: ' + bad.length);
  if (bad.length) console.log('   ' + bad.join(', '));
  console.log('');
  console.log('Готово: ' + repo.html_url);
}

main().catch((e) => {
  console.error('ОШИБКА: ' + e.message);
  process.exit(1);
});
