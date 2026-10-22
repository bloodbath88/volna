"""Меню Electron: в режиме домена пункт про сервер называется «Закрыть приложение»."""
import io

PATH = "voice-app/desktop/main.js"

PAIRS = [
    ("label: 'Остановить сервер',", "label: REMOTE ? 'Закрыть приложение' : 'Остановить сервер',"),
    ("message: 'Остановить сервер «Волны»?',", "message: REMOTE ? 'Закрыть приложение?' : 'Остановить сервер «Волны»?',"),
    (
        "detail: 'Окно приложения закроется. Запустить снова — ярлык «Волна».',",
        "detail: REMOTE\n                ? 'Окно закроется. Сервер работает на домене и продолжит работать.'\n                : 'Окно приложения закроется. Запустить снова — ярлык «Волна».',",
    ),
]

with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

changed = 0
for old, new in PAIRS:
    if old in text and new not in text:
        text = text.replace(old, new, 1)
        changed += 1

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

print("заменено:", changed)
