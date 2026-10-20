"""Заметки к релизу 1.2.2 (английский)."""
import io
import re

PATH = "deploy/release-notes.md"
with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

text = re.sub(
    r"^# Volna .*$",
    "# Volna 1.2.2 — seamless chat, clearer room naming, brighter backdrop",
    text,
    count=1,
    flags=re.M,
)

BLOCK = (
    "## What's new in 1.2.2\n"
    "\n"
    "- **Room naming is explicit.** The page title reads **Volna**, the current room is shown as\n"
    "  **Main** or **Subroom 1 / Subroom 2 …** — a parent name never leaks into a child,\n"
    "  every entry carries its own label.\n"
    "- **Seamless chat.** The panel lost its border and background card: it fades into the stage\n"
    "  and stays visible for every participant.\n"
    "- **Brighter backdrop** on both the room and the sign-in screen; the sign-in card is\n"
    "  semi-transparent so the artwork shows through.\n"
    "- **Screen sharing hardened.** If the system refuses to capture desktop audio or the server\n"
    "  rejects simulcast layers, the app falls back automatically (video-only, then plain publish)\n"
    "  instead of failing silently.\n"
    "- **1440p60 viewing.** Screen share publishes 720p / 1080p / 1440p simulcast layers;\n"
    "  a viewer gets the top layer on full screen (double-click the shared video).\n"
    "\n"
)

if "What's new in 1.2.2" not in text:
    text = text.replace("## What's new", BLOCK + "## What's new", 1)

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

print("заголовок:", text.splitlines()[0])
