"""Заметки к релизу 1.4.2 (английский)."""
import io
import re

PATH = "deploy/release-notes.md"
with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

text = re.sub(
    r"^# Volna .*$",
    "# Volna 1.4.2 — connection ping indicator",
    text,
    count=1,
    flags=re.M,
)

BLOCK = (
    "## What's new in 1.4.2\n"
    "\n"
    "- **Ping in the header.** A live round-trip indicator sits next to the participant counter:\n"
    "  green under 80 ms, amber under 180 ms, red above. It is measured from the active\n"
    "  peer connection (`candidate-pair.currentRoundTripTime`) every three seconds and resets\n"
    "  to “—” when the room is closed.\n"
    "\n"
)

if "What's new in 1.4.2" not in text:
    text = text.replace("## What", BLOCK + "## What", 1)

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

print("заголовок:", text.splitlines()[0])
