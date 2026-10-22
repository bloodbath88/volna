"""Включает кнопки «показать пароль» на экране входа приложения и в форме комнаты."""
import io
import re

PATH = "voice-app/public/entry.js"

with io.open(PATH, encoding="utf-8", newline="") as fh:
    text = fh.read()

nl = "\r\n" if "\r\n" in text else "\n"

# 1) в showAuthScreen — сразу после вставки карточки в документ
if "document.body.append(box);" + nl + "    attachAllPasswordToggles();" not in text:
    text = text.replace(
        "document.body.append(box);",
        "document.body.append(box);" + nl + "    attachAllPasswordToggles();",
        1,
    )

# 2) в initEntry — чтобы работало поле пароля комнаты
if "renderFriendsPanel();" + nl + "    attachAllPasswordToggles();" not in text:
    text = text.replace(
        "renderFriendsPanel();",
        "renderFriendsPanel();" + nl + "    attachAllPasswordToggles();",
        1,
    )

with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
    fh.write(text)

print("вхождений attachAllPasswordToggles():", text.count("attachAllPasswordToggles()"))
