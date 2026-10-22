"""Заменяет prefillJoinName на версию, которая перебивает «Гость-N»."""
import io

PATH = "voice-app/public/entry.js"
with io.open(PATH, encoding="utf-8", newline="") as fh:
    text = fh.read()

nl = "\r\n" if "\r\n" in text else "\n"

start = text.find("function prefillJoinName() {")
end = text.find("function setHostName() {")
if start < 0 or end < 0 or end < start:
    raise SystemExit("не найдены границы функции")

new = (
    "function prefillJoinName() {" + nl +
    "    const input = $('#nameInput');" + nl +
    "    if (!input || !AUTH.login) return;" + nl +
    "    const apply = () => {" + nl +
    "      if (!input.value || /^Гость-\\d+$/i.test(input.value)) input.value = AUTH.login;" + nl +
    "    };" + nl +
    "    apply();" + nl +
    "    // app.js ставит «Гость-N» при своей инициализации — перебиваем первые секунды" + nl +
    "    let ticks = 0;" + nl +
    "    const timer = setInterval(() => {" + nl +
    "      apply();" + nl +
    "      if (++ticks > 20) clearInterval(timer);" + nl +
    "    }, 400);" + nl +
    "  }" + nl + nl +
    "  "
)

text = text[:start] + new + text[end:]
with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
    fh.write(text)
print("prefillJoinName обновлён")
