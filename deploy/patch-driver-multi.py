"""Добавляет в тестовый сценарий chat снятие защиты от повторного входа (только для тестов)."""
import io

PATH = "tools/volna-driver.mjs"
NEEDLE = "const cdpB = await Cdp.connect(pageB.webSocketDebuggerUrl);"
INJECT = (
    NEEDLE
    + "\n        // тест открывает два окна одного профиля — снимаем защиту от повторного входа"
    + "\n        await cdpB.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__volnaAllowMulti = true;' });"
)

with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

if "__volnaAllowMulti" in text:
    print("уже есть")
else:
    text = text.replace(NEEDLE, INJECT, 1)
    with io.open(PATH, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("сценарий обновлён")
