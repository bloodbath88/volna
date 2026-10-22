"""Друзья переезжают в правую колонку (aside.side)."""
import io

PATH = "voice-app/public/entry.js"

with io.open(PATH, encoding="utf-8", newline="") as fh:
    text = fh.read()

old = "    const box = document.querySelector('.chan-scroll');"
new = "    const box = document.querySelector('.side') || document.querySelector('.chan-scroll');"

if new in text:
    print("уже есть")
else:
    text = text.replace(old, new, 1)
    text = text.replace("    box.append(wrap);", "    wrap.classList.add('side-block');\n    box.append(wrap);", 1)
    with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    print("готово: друзья в правой колонке")
