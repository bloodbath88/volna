"""Заметки к релизу 1.5.1 (английский)."""
import io
import re

PATH = "deploy/release-notes.md"
with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

text = re.sub(
    r"^# Volna .*$",
    "# Volna 1.5.1 — everything on the domain",
    text,
    count=1,
    flags=re.M,
)

BLOCK = (
    "## What's new in 1.5.1\n"
    "\n"
    "- **HTTP → HTTPS redirect.** A small service (`server/redirect.js`, unit `volna-redirect`)\n"
    "  answers on port 80 and sends every request to `https://volna.is-cool.dev`.\n"
    "- **Invites use the domain.** The address list that the “Invite” button reads puts the domain\n"
    "  first, so shared links point at the domain rather than an IP.\n"
    "- **Certificate renewal hook** restarts the application after `certbot renew`, so a renewed\n"
    "  certificate is picked up automatically.\n"
    "\n"
)

if "What's new in 1.5.1" not in text:
    text = text.replace("## What", BLOCK + "## What", 1)

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

print("заголовок:", text.splitlines()[0])
