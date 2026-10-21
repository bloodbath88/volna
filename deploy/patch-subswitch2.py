"""В сценарии subswitch2 ждём появления формы входа во втором окне."""
import io

PATH = "tools/volna-driver.mjs"
OLD = (
    "      await cdpB.send('Page.navigate', { url: BASE + '/?room=' + encodeURIComponent(room) });\n"
    "      await sleep(1500);\n"
    "      await cdpB.eval(setJoinFields('Второй', pass, room), false);"
)
NEW = (
    "      await cdpB.send('Page.navigate', { url: BASE + '/?room=' + encodeURIComponent(room) });\n"
    "      for (let i = 0; i < 24; i++) {\n"
    "        await sleep(500);\n"
    "        const ready = await cdpB.eval(\"!!document.querySelector('#joinBtn')\", false);\n"
    "        if (ready) break;\n"
    "      }\n"
    "      await sleep(300);\n"
    "      await cdpB.eval(setJoinFields('Второй', pass, room), false);"
)

with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

if OLD in text:
    text = text.replace(OLD, NEW, 1)
    with io.open(PATH, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("патч применён")
else:
    print("шаблон не найден")
