"""Добавляет версию к ссылкам на стили и скрипты, чтобы после деплоя не было старой версии из кэша."""
import io
import re

PATH = "voice-app/public/index.html"
VERSION = "20261021b"
ASSETS = ["fonts/fonts.css", "styles.css", "vendor/livekit-client.umd.js", "app.js", "entry.js"]

with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

for asset in ASSETS:
    # заменяем и чистый адрес, и уже версионированный
    text = re.sub(
        r'(["\'])' + re.escape(asset) + r'(\?v=[^"\']*)?(["\'])',
        lambda m: m.group(1) + asset + "?v=" + VERSION + m.group(3),
        text,
    )

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

found = re.findall(r'(?:src|href)="([^"]*(?:entry|app|styles|fonts)[^"]*)"', text)
print("ссылки:", found)
