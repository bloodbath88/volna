/** Проверка релиза: что приложено и совпадает ли размер с локальными архивами. */
import { statSync } from 'node:fs';

const REPO = process.env.GH_REPO || 'bloodbath88/volna';
const TAG = process.env.GH_TAG || 'v1.2.1';
const token = (process.env.GH_TOKEN || '').trim();

const res = await fetch('https://api.github.com/repos/' + REPO + '/releases/tags/' + TAG, {
  headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'volna' },
});
const rel = await res.json();

for (const asset of rel.assets || []) {
  const local = statSync(asset.name);
  const same = local.size === asset.size;
  console.log(asset.name, (asset.size / 1048576).toFixed(2) + ' МБ', same ? 'размер совпадает' : 'РАЗМЕР НЕ СОВПАЛ');
}
console.log('в описании упомянута «Главная»:', String(rel.body || '').includes('Главная'));
console.log('заголовок:', rel.name);
