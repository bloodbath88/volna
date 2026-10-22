"""Убирает дублирующийся импорт session в desktop/main.js."""
import io

PATH = "voice-app/desktop/main.js"
with io.open(PATH, encoding="utf-8", newline="") as fh:
    text = fh.read()

bad = "const { app, session, BrowserWindow, Menu, shell, dialog, desktopCapturer, session } = require('electron');"
good = "const { app, BrowserWindow, Menu, shell, dialog, desktopCapturer, session } = require('electron');"

if bad in text:
    text = text.replace(bad, good, 1)
    with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    print("импорт исправлен")
else:
    print("дубля нет")
