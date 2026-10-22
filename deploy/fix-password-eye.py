"""Исправляет неудачную вставку attachAllPasswordToggles и ставит вызов в initEntry."""
import io

PATH = "voice-app/public/entry.js"

with io.open(PATH, encoding="utf-8", newline="") as fh:
    text = fh.read()

nl = "\r\n" if "\r\n" in text else "\n"
broken = ("del.addEventListener('click', (e) => { e.stopPropagation(); removeFriend(friend.name); renderFriendsPanel();"
          + nl + "    attachAllPasswordToggles(); });")
fixed = "del.addEventListener('click', (e) => { e.stopPropagation(); removeFriend(friend.name); renderFriendsPanel(); });"

if broken in text:
    text = text.replace(broken, fixed, 1)
    print("строка друга восстановлена")

anchor = "    bindFriendsPanel();"
if anchor in text and "bindFriendsPanel();" + nl + "    attachAllPasswordToggles();" not in text:
    text = text.replace(anchor, anchor + nl + "    attachAllPasswordToggles();", 1)
    print("вызов добавлен в initEntry")

with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
    fh.write(text)

print("итого вызовов:", text.count("attachAllPasswordToggles();"))
