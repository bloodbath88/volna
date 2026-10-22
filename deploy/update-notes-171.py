"""Заметки к релизу 1.7.1 (английский)."""
import io
import re

PATH = "deploy/release-notes.md"
with io.open(PATH, encoding="utf-8", newline="") as fh:
    text = fh.read()

text = re.sub(
    r"^# Volna .*$",
    "# Volna 1.7.1 — show password buttons",
    text,
    count=1,
    flags=re.M,
)

BLOCK = (
    "## What's new in 1.7.1\n"
    "\n"
    "- **Show password.** Every password field (sign-in, repeat password, room password) has an eye\n"
    "  button: one click reveals the text, another hides it, the icon switches between open and\n"
    "  crossed out. Works on the sign-in screen and in the join form.\n"
    "\n"
)

if "What's new in 1.7.1" not in text:
    text = text.replace("## What", BLOCK + "## What", 1)

with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
    fh.write(text)

print("заголовок:", text.splitlines()[0])
