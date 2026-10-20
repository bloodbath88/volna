"""Обновляет сценарий chat: чат теперь всегда открыт, кнопок «Чат»/«свернуть» нет."""
import io

PATH = "tools/volna-driver.mjs"
with io.open(PATH, encoding="utf-8") as fh:
    lines = fh.readlines()

out = []
for line in lines:
    if "document.querySelector('#chatBtn')" in line:
        continue  # кнопки больше нет
    if "document.querySelector('#chatCloseBtn')" in line:
        continue  # сворачивания больше нет
    if line.strip().startswith("const badge = await cdp.eval("):
        out.append(
            "        const chatVisible = await cdp.eval(\"(() => { const p = document.querySelector('#chatPanel'); "
            "return !!p && !p.classList.contains('hidden'); })()\", false);\n"
        )
        continue
    if "step('" in line and "badge" in line:
        continue
    if line.strip().startswith("report.ok = inRoom(s) && inRoom(sb)"):
        out.append(
            "        report.ok = inRoom(s) && inRoom(sb) && bLog.indexOf(msg1) >= 0 && aLog.indexOf(msg2) >= 0 && chatVisible;\n"
        )
        continue
    out.append(line)

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.writelines(out)

print("готово, строк:", len(out))
