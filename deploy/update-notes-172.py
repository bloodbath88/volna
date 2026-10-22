"""Заметки к релизу 1.7.2 (английский)."""
import io
import re

PATH = "deploy/release-notes.md"
with io.open(PATH, encoding="utf-8", newline="") as fh:
    text = fh.read()

text = re.sub(
    r"^# Volna .*$",
    "# Volna 1.7.2 — remember me, real names",
    text,
    count=1,
    flags=re.M,
)

BLOCK = (
    "## What's new in 1.7.2\n"
    "\n"
    "- **Remember me.** The sign-in card has a checkbox: when it is on, the login is remembered and\n"
    "  the next launch signs the user in automatically; the session lasts a year instead of a day.\n"
    "  Turning the checkbox off keeps the session until the tab is closed and forgets the login.\n"
    "- **No random guest names.** The join form no longer generates “Guest-1234” — the name is taken\n"
    "  from the signed-in account, so people appear under their own login.\n"
    "\n"
)

if "What's new in 1.7.2" not in text:
    text = text.replace("## What", BLOCK + "## What", 1)

with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
    fh.write(text)

print("заголовок:", text.splitlines()[0])
