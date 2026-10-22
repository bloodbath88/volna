"""Показывает текущий вид prefillJoinName и правит его построчно."""
import io

PATH = "voice-app/public/entry.js"
with io.open(PATH, encoding="utf-8", newline="") as fh:
    text = fh.read()

nl = "\r\n" if "\r\n" in text else "\n"
i = text.find("function prefillJoinName")
print(repr(text[i:i + 320]) if i >= 0 else "не найдено")
