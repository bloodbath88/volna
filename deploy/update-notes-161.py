"""Заметки к релизу 1.6.1 (английский)."""
import io
import re

PATH = "deploy/release-notes.md"
with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

text = re.sub(
    r"^# Volna .*$",
    "# Volna 1.6.1 — desktop app works on the domain",
    text,
    count=1,
    flags=re.M,
)

BLOCK = (
    "## What's new in 1.6.1\n"
    "\n"
    "- **Desktop app can run against the domain.** If `remote.json` exists (in `%APPDATA%\\Volna\\`\n"
    "  or next to the app), Electron loads that URL with the invite code, skips starting a local\n"
    "  server entirely and joins the room on the remote host.\n"
    "- Tested: the window opens `https://volna.is-cool.dev`, the room is joined, the participant tile\n"
    "  is rendered, ping shows 63 ms, and no local Node or LiveKit processes are spawned.\n"
    "- The file is personal (it contains the room code) and is not part of the repository.\n"
    "\n"
)

if "What's new in 1.6.1" not in text:
    text = text.replace("## What", BLOCK + "## What", 1)

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

print("заголовок:", text.splitlines()[0])
