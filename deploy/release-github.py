#!/usr/bin/env python
"""
Публикует релиз с архивами в GitHub: создаёт релиз по тегу и прикладывает файлы.

Переменные окружения: GH_TOKEN (токен с правами Contents: write), GH_REPO (owner/repo).
Необязательные: GH_TAG (по умолчанию v1.0.0), GH_NAME (заголовок релиза).

Запуск (PowerShell): задать переменные окружения и выполнить
  python deploy/release-github.py
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUTH = os.environ.get("GH_TOKEN", "").strip()
REPO = os.environ.get("GH_REPO", "").strip()
TAG = os.environ.get("GH_TAG", "v1.0.0").strip() or "v1.0.0"
NAME = os.environ.get("GH_NAME", "Волна 1.0 — сборки для Windows и Linux").strip()
BODY_FILE = os.path.join(ROOT, "deploy", "release-notes.md")
ASSETS = [
    ("volna-voice-app.zip", "application/zip"),
    ("volna-voice-app-linux.tar.gz", "application/gzip"),
]
API = "https://api.github.com"
UPLOAD = "https://uploads.github.com"


def call(method, url, payload=None, ok=(200, 201, 204)):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + AUTH)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read().decode("utf-8", "replace")
            return resp.status, (json.loads(body) if body.strip() else {})
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        if exc.code in ok:
            return exc.code, (json.loads(body) if body.strip() else {})
        print("ОШИБКА " + method + " " + url + " -> " + str(exc.code))
        print(body[:600])
        raise


def main():
    if not AUTH or "/" not in REPO:
        print("Нужны GH_TOKEN и GH_REPO (owner/repo)")
        return 2

    body = ""
    if os.path.exists(BODY_FILE):
        with open(BODY_FILE, "r", encoding="utf-8") as fh:
            body = fh.read()

    status, existing = call("GET", API + "/repos/" + REPO + "/releases/tags/" + TAG, ok=(200, 404))
    if status == 200:
        release = existing
        print("Релиз " + TAG + " уже есть, добавляю файлы в него")
    else:
        status, release = call(
            "POST",
            API + "/repos/" + REPO + "/releases",
            {
                "tag_name": TAG,
                "name": NAME,
                "body": body,
                "draft": False,
                "prerelease": False,
            },
        )
        print("Релиз создан: " + release.get("html_url", ""))

    release_id = release["id"]
    have = {a["name"] for a in release.get("assets", [])}

    for filename, mime in ASSETS:
        path = os.path.join(ROOT, filename)
        if not os.path.exists(path):
            print("Нет файла " + filename + " — пропускаю")
            continue
        if filename in have:
            print("Файл " + filename + " уже приложен")
            continue
        size = os.path.getsize(path)
        with open(path, "rb") as fh:
            data = fh.read()
        url = UPLOAD + "/repos/" + REPO + "/releases/" + str(release_id) + "/assets?name=" + urllib.parse.quote(filename)
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Authorization", "Bearer " + AUTH)
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("Content-Type", mime)
        req.add_header("Content-Length", str(size))
        try:
            with urllib.request.urlopen(req, timeout=600) as resp:
                asset = json.loads(resp.read().decode("utf-8", "replace"))
                print("Загружен " + filename + " (" + str(round(size / 1048576, 2)) + " МБ) -> " + asset.get("browser_download_url", ""))
        except urllib.error.HTTPError as exc:
            print("ОШИБКА загрузки " + filename + " -> " + str(exc.code))
            print(exc.read().decode("utf-8", "replace")[:400])
            return 1

    status, final = call("GET", API + "/repos/" + REPO + "/releases/tags/" + TAG)
    print("")
    print("Релиз: " + final.get("html_url", ""))
    for a in final.get("assets", []):
        print("  " + a["name"] + " — " + str(round(a["size"] / 1048576, 2)) + " МБ, скачиваний: " + str(a["download_count"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
