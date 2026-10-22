"""Отключает автовход: приглашение только заполняет поля, вход — по кнопке."""
import io

PATH = "voice-app/public/entry.js"

PAIRS = [
    (
        "        if (store.get('auto', '1') !== '0') startCountdown(3, 'Вас приглашают в комнату «' + inv.room + '»');",
        "        // автовход отключён: приглашение только заполняет поля\n        toast('Приглашение получено — проверьте имя и нажмите «Войти в комнату»');",
    ),
    (
        "      startCountdown(3);",
        "      toast('Данные комнаты подставлены — нажмите «Войти в комнату»');",
    ),
    (
        "        startCountdown(2, 'Подключаемся к комнате «' + saved.room + '»');",
        "        toast('Последняя комната подставлена — нажмите «Войти в комнату»');",
    ),
]

with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

changed = 0
for old, new in PAIRS:
    if old in text:
        text = text.replace(old, new, 1)
        changed += 1

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

print("заменено:", changed)
