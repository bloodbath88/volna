"""Переносит друзей в .side, возвращает блок аккаунта в левую колонку."""
import io

PATH = "voice-app/public/entry.js"
with io.open(PATH, encoding="utf-8", newline="") as fh:
    text = fh.read()

nl = "\r\n" if "\r\n" in text else "\n"

side_line = "    const box = document.querySelector('.side') || document.querySelector('.chan-scroll');"
plain = "    const box = document.querySelector('.chan-scroll');"

# 1) вернуть блок аккаунта в левую колонку (первое вхождение side_line)
if text.count(side_line) == 1:
    text = text.replace(side_line, plain, 1)
    print("блок аккаунта возвращён влево")

# 2) внутри bindFriendsPanel — в правую колонку
marker = "  function bindFriendsPanel() {"
i = text.find(marker)
if i < 0:
    raise SystemExit("bindFriendsPanel не найден")

j = text.find(plain, i)
if j < 0 or j - i > 500:
    print("внутри bindFriendsPanel строка не найдена рядом")
else:
    text = text[:j] + side_line + text[j + len(plain):]
    print("друзья -> .side")

with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
    fh.write(text)

# контроль
for k, line in enumerate(text.split(nl), 1):
    if "querySelector('.side')" in line or "function bindFriendsPanel" in line:
        print(k, line.strip())
