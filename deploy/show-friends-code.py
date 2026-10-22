"""Показывает bindFriendsPanel и места, куда вставлен side-block."""
import io

PATH = "voice-app/public/entry.js"
with io.open(PATH, encoding="utf-8") as fh:
    lines = fh.read().splitlines()

for i, line in enumerate(lines):
    if "function bindFriendsPanel" in line:
        print("\n".join(lines[i:i + 10]))
        print("----")
break_outer = False
for i, line in enumerate(lines):
    if "side-block" in line or "querySelector('.side')" in line:
        print(i + 1, line.strip())
