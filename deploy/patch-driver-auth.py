"""Драйвер: перед загрузкой страницы создаёт локальную сессию, чтобы тесты проходили экран входа."""
import io

PATH = "tools/volna-driver.mjs"
NEEDLE = "      await cdp.send('Page.navigate', { url: BASE + '/?room=' + encodeURIComponent(room) + query });"

INJECT = (
    "      // тестовая сессия: приложение требует вход по логину и паролю\n"
    "      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {\n"
    "        source: \"try { localStorage.setItem('volna.session', JSON.stringify({ login: 'test', until: Date.now() + 2592000000 })); } catch (e) {}\",\n"
    "      });\n"
) + NEEDLE

with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

if "volna.session" in text:
    print("уже есть")
else:
    text = text.replace(NEEDLE, INJECT, 1)
    with io.open(PATH, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("патч применён")
