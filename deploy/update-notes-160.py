"""Заметки к релизу 1.6.0 (английский)."""
import io
import re

PATH = "deploy/release-notes.md"
with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

text = re.sub(
    r"^# Volna .*$",
    "# Volna 1.6.0 — steadier audio, faster room switch, stream in its own window",
    text,
    count=1,
    flags=re.M,
)

BLOCK = (
    "## What's new in 1.6.0\n"
    "\n"
    "- **Audio stays level during screen sharing.** Screen-share bitrate was cut (1440p 12 → 6 Mbit/s,\n"
    "  1080p 6 → 4.5, layers 1.2/2.8/4.5), DTX is off, RED is on and voice is published at 64 kbit/s,\n"
    "  so a heavy stream no longer squeezes the voice channel.\n"
    "- **Room switch feels instant.** The “switching room” overlay appears only if the transition takes\n"
    "  longer than 250 ms, so a quick switch shows nothing at all.\n"
    "- **Stream in its own window.** A “В окне” button on the stage bar pops the shared screen into\n"
    "  Picture-in-Picture; where PiP is unavailable a separate browser window is opened with the same\n"
    "  stream. Works both for the broadcaster and for viewers.\n"
    "\n"
)

if "What's new in 1.6.0" not in text:
    text = text.replace("## What", BLOCK + "## What", 1)

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

print("заголовок:", text.splitlines()[0])
