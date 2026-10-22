"""shotauth: дополнительно сообщает, сколько кнопок «глаз» отрисовалось."""
import io

PATH = "tools/volna-driver.mjs"
OLD = "      const state = await cdp.eval(\"(() => ({ auth: !!document.querySelector('#authScreen') }))()\", false);"
NEW = (
    "      const state = await cdp.eval(\"(() => ({ auth: !!document.querySelector('#authScreen'), "
    "eyes: document.querySelectorAll('.pass-eye').length, "
    "passTypes: Array.from(document.querySelectorAll('input')).map((i) => i.type).join(',') }))()\", false);"
)

with io.open(PATH, encoding="utf-8", newline="") as fh:
    text = fh.read()

if "eyes: document.querySelectorAll" in text:
    print("уже есть")
else:
    text = text.replace(OLD, NEW, 1)
    with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    print("обновлено")
