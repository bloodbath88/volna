"""Заметки к релизу 1.2.3 (английский)."""
import io
import re

PATH = "deploy/release-notes.md"
with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

text = re.sub(
    r"^# Volna .*$",
    "# Volna 1.2.3 — cleaner channel list, full-width chat, new join sound",
    text,
    count=1,
    flags=re.M,
)

BLOCK = (
    "## What's new in 1.2.3\n"
    "\n"
    "- **Channel list simplified.** The extra header row is gone: the panel starts with the list,\n"
    "  the current room row reads **Main** and carries the **+** button for creating sub-rooms.\n"
    "  Rooms are created only when you press it.\n"
    "- **Typed name applied immediately.** A sub-room you name is shown with that name at once;\n"
    "  only unnamed rooms get **Subroom 1**, **Subroom 2** …\n"
    "- **Chat takes the full width** of the stage; its input row now stretches edge to edge.\n"
    "- **Join sound** replaced with a short two-note chime, closer to Discord; a single lower tone\n"
    "  plays when somebody leaves.\n"
    "- **Custom scrollbars** — rounded, accent-tinted, in line with the rest of the interface.\n"
    "- The **«Чат» button** in the top bar was removed: the chat is always on screen.\n"
    "\n"
)

if "What's new in 1.2.3" not in text:
    text = text.replace("## What's new", BLOCK + "## What's new", 1)

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

print("заголовок:", text.splitlines()[0])
