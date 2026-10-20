"""Заметки к релизу 1.4.4 (английский)."""
import io
import re

PATH = "deploy/release-notes.md"
with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

text = re.sub(
    r"^# Volna .*$",
    "# Volna 1.4.4 — no phantom “Client initiated disconnect”",
    text,
    count=1,
    flags=re.M,
)

BLOCK = (
    "## What's new in 1.4.4\n"
    "\n"
    "- **Phantom join errors removed.** When a room is left or switched, LiveKit reports the\n"
    "  disconnect of the previous connection; those notifications are now filtered out, so the room\n"
    "  no longer shows “Не удалось войти: Client initiated disconnect”. Real errors stay visible.\n"
    "- **Single join attempt.** A second join is ignored while the first one is in flight or while\n"
    "  you are already in a room, which removes a source of double connections.\n"
    "\n"
)

if "What's new in 1.4.4" not in text:
    text = text.replace("## What", BLOCK + "## What", 1)

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

print("заголовок:", text.splitlines()[0])
