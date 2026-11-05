"""При переходе между комнатами не убираем сцену — иначе чёрный экран."""
import io

PATH = "voice-app/public/entry.js"
with io.open(PATH, encoding="utf-8", newline="") as fh:
    text = fh.read()

nl = "\r\n" if "\r\n" in text else "\n"
old = "    if (stage) stage.classList.add('hidden');"
new = "    if (stage && !SWITCH.active) stage.classList.add('hidden'); // при переходе оставляем кадр на экране"

if new in text:
    print("уже есть")
else:
    text = text.replace(old, new, 1)
    with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    print("сцена остаётся видимой при переходе")
