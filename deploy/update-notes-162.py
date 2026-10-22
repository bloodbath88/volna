"""Заметки к релизу 1.6.2 (английский)."""
import io
import re

PATH = "deploy/release-notes.md"
with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

text = re.sub(
    r"^# Volna .*$",
    "# Volna 1.6.2 — desktop app polish for domain mode",
    text,
    count=1,
    flags=re.M,
)

BLOCK = (
    "## What's new in 1.6.2\n"
    "\n"
    "- **Menu adapts to the mode.** With `remote.json` present the item that used to stop a local\n"
    "  server now reads “Закрыть приложение” and its dialog explains that the room keeps running on\n"
    "  the domain.\n"
    "- Verified again: the window opens `https://volna.is-cool.dev`, joins the room, renders one tile,\n"
    "  shows 66 ms ping and spawns no local Node or LiveKit processes.\n"
    "\n"
)

if "What's new in 1.6.2" not in text:
    text = text.replace("## What", BLOCK + "## What", 1)

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

print("заголовок:", text.splitlines()[0])
