"""Заметки к релизу 1.7.3 (английский)."""
import io
import re

PATH = "deploy/release-notes.md"
with io.open(PATH, encoding="utf-8", newline="") as fh:
    text = fh.read()

text = re.sub(
    r"^# Volna .*$",
    "# Volna 1.7.3 — friends on the right, no guest names",
    text,
    count=1,
    flags=re.M,
)

BLOCK = (
    "## What's new in 1.7.3\n"
    "\n"
    "- **Friends moved to the right column.** The friends list now lives in its own panel on the\n"
    "  right, next to the stage; the left column keeps rooms, participants and the account row.\n"
    "- **No more “Guest-1234”.** The join form takes the name from the signed-in account, even when\n"
    "  the bundled legacy script tries to insert a random guest name on startup.\n"
    "- **Fresh UI after an update.** The desktop window clears its HTTP cache before loading, so a new\n"
    "  build shows up right away instead of an old cached page.\n"
    "\n"
)

if "What's new in 1.7.3" not in text:
    text = text.replace("## What", BLOCK + "## What", 1)

with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
    fh.write(text)

print("заголовок:", text.splitlines()[0])
