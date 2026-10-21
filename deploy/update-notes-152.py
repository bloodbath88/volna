"""Заметки к релизу 1.5.2 (английский)."""
import io
import re

PATH = "deploy/release-notes.md"
with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

text = re.sub(
    r"^# Volna .*$",
    "# Volna 1.5.2 — participant stays visible after creating a room",
    text,
    count=1,
    flags=re.M,
)

BLOCK = (
    "## What's new in 1.5.2\n"
    "\n"
    "- **Fixed: the participant disappeared after creating a sub-room.** The room switch used to\n"
    "  hide the sign-in screen to avoid a flash; that skipped the client's re-render, so tiles and the\n"
    "  participant list stayed empty while the counter showed 1. The screen now runs its normal flow\n"
    "  and a short overlay covers the transition instead.\n"
    "- Verified on the domain: after creating a room there is 1 tile and 1 row in Participants.\n"
    "\n"
)

if "What's new in 1.5.2" not in text:
    text = text.replace("## What", BLOCK + "## What", 1)

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

print("заголовок:", text.splitlines()[0])
