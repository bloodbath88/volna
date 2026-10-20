"""Обновляет английские заметки к релизу: версия 1.2.1 и список изменений."""
import io

PATH = "deploy/release-notes.md"
with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

text = text.replace(
    "# Volna 1.2 — interface refresh, Discord-style rooms, English docs",
    "# Volna 1.2.1 — centered chat, instant room switching, English docs",
    1,
)

BLOCK = (
    "## What's new in 1.2.1\n"
    "\n"
    "- **Chat moved to the center.** It is now a wide panel at the bottom of the stage,\n"
    "  always visible and shared by everyone in the room — no toggle, no separate window.\n"
    "- **Instant switching.** Going from a room to a sub-room no longer flashes the join\n"
    "  screen: the current view stays until the new connection is ready.\n"
    "- **Predictable names.** The main room is always `main` and cannot be renamed;\n"
    "  new rooms get `subroom`, `subroom-2`, `subroom-3` … by default.\n"
    "- **Cleaner chat header.** Only the attach button remains there; rooms are created\n"
    "  from the channel list with **+**.\n"
    "- **Brighter background** so the artwork and every interface element stay readable.\n"
    "\n"
)

if "What's new in 1.2.1" not in text:
    text = text.replace("## What's new", BLOCK + "## What's new", 1)

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

print("заголовок:", text.splitlines()[0])
print("блок добавлен:", "What's new in 1.2.1" in text)
