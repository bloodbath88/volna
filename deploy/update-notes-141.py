"""Заметки к релизу 1.4.1 (английский)."""
import io
import re

PATH = "deploy/release-notes.md"
with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

text = re.sub(
    r"^# Volna .*$",
    "# Volna 1.4.1 — flat channel list, no switch errors",
    text,
    count=1,
    flags=re.M,
)

BLOCK = (
    "## What's new in 1.4.1\n"
    "\n"
    "- **Channel list is always flat.** A room created while standing in a sub-room could produce\n"
    "  a name like `main--pubg--ererer` and looked nested. Stored names are migrated to their last\n"
    "  segment, so Main always lists its rooms at one level.\n"
    "- **No false join errors.** When switching rooms, the disconnect of the previous connection is\n"
    "  no longer shown as “Не удалось войти: Client initiated disconnect”.\n"
    "\n"
)

if "What's new in 1.4.1" not in text:
    text = text.replace("## What", BLOCK + "## What", 1)

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

print("заголовок:", text.splitlines()[0])
