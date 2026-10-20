"""chat-сценарий: разрешаем два окна одного профиля (тест), снимая метку входа."""
import io

PATH = "tools/volna-driver.mjs"
NEEDLE = "        await cdpB.send('Page.navigate', { url: BASE + '/?room=' + encodeURIComponent(room) });"

with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

if "localStorage.removeItem('volna.lock')" in text:
    print("уже есть")
else:
    text = text.replace(
        NEEDLE,
        "        await cdp.eval(\"(() => { window.__volnaAllowMulti = true; localStorage.removeItem('volna.lock'); return true; })()\", false);\n" + NEEDLE,
        1,
    )
    with io.open(PATH, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("патч применён")
