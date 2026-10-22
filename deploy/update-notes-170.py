"""Заметки к релизу 1.7.0 (английский)."""
import io
import re

PATH = "deploy/release-notes.md"
with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

text = re.sub(
    r"^# Volna .*$",
    "# Volna 1.7.0 — app sign-in, friends panel, no auto-join",
    text,
    count=1,
    flags=re.M,
)

BLOCK = (
    "## What's new in 1.7.0\n"
    "\n"
    "- **Sign-in screen with login and password.** A profile is created on the device (login,\n"
    "  password hashed with PBKDF2-SHA-256, 120k iterations), a session lasts 30 days and can be\n"
    "  closed from the left column. Note: accounts are local to the browser, not server-side, because\n"
    "  the room itself is protected by the shared room password.\n"
    "- **No automatic entry.** Invite links and the last room only prefill the form; joining requires\n"
    "  an explicit “Войти в комнату”. The auto-join countdown is gone.\n"
    "- **Friends panel** under the participants: add by name, online dot reflects the current room,\n"
    "  one click to visit a friend's room, ✕ to remove.\n"
    "\n"
)

if "What's new in 1.7.0" not in text:
    text = text.replace("## What", BLOCK + "## What", 1)

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

print("заголовок:", text.splitlines()[0])
