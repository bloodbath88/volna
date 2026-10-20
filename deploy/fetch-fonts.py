"""Скачивает шрифты для интерфейса и собирает локальный fonts.css (без внешних CDN)."""
import os
import re
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126"
API = "https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;800&display=swap"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "voice-app", "public", "fonts")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    req = urllib.request.Request(API, headers={"User-Agent": UA})
    css = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")

    urls = []
    for match in re.finditer(r"url\((https://[^)]+\.woff2)\)", css):
        if match.group(1) not in urls:
            urls.append(match.group(1))

    for index, url in enumerate(urls, 1):
        name = "f%d.woff2" % index
        data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=40).read()
        with open(os.path.join(OUT_DIR, name), "wb") as fh:
            fh.write(data)
        css = css.replace(url, name)

    path = os.path.join(OUT_DIR, "fonts.css")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(css)

    families = sorted(set(re.findall(r"font-family: '([^']+)'", css)))
    print("файлов:", len(urls), "| семейства:", ", ".join(families), "| css:", len(css), "байт")


if __name__ == "__main__":
    main()
