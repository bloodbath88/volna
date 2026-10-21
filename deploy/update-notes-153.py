"""Заметки к релизу 1.5.3 (английский)."""
import io
import re

PATH = "deploy/release-notes.md"
with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

text = re.sub(
    r"^# Volna .*$",
    "# Volna 1.5.3 — cache-busted assets, participant render fix",
    text,
    count=1,
    flags=re.M,
)

BLOCK = (
    "## What's new in 1.5.3\n"
    "\n"
    "- **Assets are versioned** (`?v=…` on styles and scripts). Static files are served with a\n"
    "  one-hour cache, so after an update the browser used to keep the old client for up to an hour;\n"
    "  now a new build is fetched immediately.\n"
    "- **Participant stays visible after creating a sub-room** — the switch runs the normal join flow\n"
    "  under a short overlay, so tiles and the participant list are rendered again.\n"
    "\n"
)

if "What's new in 1.5.3" not in text:
    text = text.replace("## What", BLOCK + "## What", 1)

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

print("заголовок:", text.splitlines()[0])
