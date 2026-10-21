"""Заметки к релизу 1.5.0 (английский)."""
import io
import re

PATH = "deploy/release-notes.md"
with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

text = re.sub(
    r"^# Volna .*$",
    "# Volna 1.5.0 — domain, battle wallpaper, tidier chat row",
    text,
    count=1,
    flags=re.M,
)

BLOCK = (
    "## What's new in 1.5.0\n"
    "\n"
    "- **Custom domain.** The server now answers on `https://volna.is-cool.dev` with a Let's Encrypt\n"
    "  certificate (auto-renewed), port 443, no browser warnings.\n"
    "- **New room backdrop.** A panoramic battlefield in the spirit of Dota 2: a stone bridge over a\n"
    "  glowing river, a Radiant tower with green runes, a Dire tower in fire, armies in the fog.\n"
    "- **Attach button moved** into the message row, right next to Send.\n"
    "\n"
)

if "What's new in 1.5.0" not in text:
    text = text.replace("## What", BLOCK + "## What", 1)

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

print("заголовок:", text.splitlines()[0])
