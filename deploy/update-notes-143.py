"""Заметки к релизу 1.4.3 (английский)."""
import io
import re

PATH = "deploy/release-notes.md"
with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

text = re.sub(
    r"^# Volna .*$",
    "# Volna 1.4.3 — «Основной» label, clean room deletion",
    text,
    count=1,
    flags=re.M,
)

BLOCK = (
    "## What's new in 1.4.3\n"
    "\n"
    "- **The main room is labelled «Основной»** everywhere in the interface; its technical name\n"
    "  stays `main`, so links and invites keep working.\n"
    "- **Deleting a sub-room leaves no trace.** The stored display name and the saved “current room”\n"
    "  are cleared together with the room, and the list is redrawn at once.\n"
    "- **Orphan names are pruned on load**, so a renamed room that no longer exists cannot reappear.\n"
    "\n"
)

if "What's new in 1.4.3" not in text:
    text = text.replace("## What", BLOCK + "## What", 1)

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

print("заголовок:", text.splitlines()[0])
