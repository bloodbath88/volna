#!/usr/bin/env python
"""
Заливает проект «Волна» в существующий репозиторий GitHub через Git Data API.
Не требует установленного git. Токен — только в переменной окружения.

Что делает:
  1. проверяет репозиторий и токен;
  2. собирает список файлов проекта по правилам .gitignore (плюс страховка от секретов);
  3. создаёт блобы, дерево и один коммит;
  4. переставляет ветку (или создаёт её, если репозиторий пустой);
  5. проверяет результат: сколько файлов в репозитории и нет ли среди них запрещённых.

Запуск (PowerShell): задать переменные окружения GH_TOKEN (токен) и GH_REPO (owner/repo),
затем выполнить: python deploy/upload-github.py
"""

import base64
import json
import os
import ssl
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUTH = os.environ.get("GH_TOKEN", "").strip()
REPO = os.environ.get("GH_REPO", "").strip()
BRANCH = os.environ.get("GH_BRANCH", "main").strip() or "main"
MESSAGE = os.environ.get("GH_MESSAGE", "Волна: голосовая комната, стриминг и настольное приложение")
API = "https://api.github.com"

SKIP_DIRS = {"node_modules", ".zwork", "build", "runtime", ".git", "certs", "run", "tmp-certs", "__pycache__"}
SKIP_NAMES = {
    "config.json", "livekit.yaml", "addresses.json", "livekit-server.exe",
    "volna_deploy_key", "volna_deploy_key.pub", "udp-mapping.txt", "DOMAIN.md",
    "turnserver.conf",
}
SKIP_EXT = (".zip", ".tar.gz", ".log", ".pid", ".pem", ".key", ".pyc")
SECRET_HINTS = ("config.json", "livekit.yaml", "addresses.json")


def call(method, path, payload=None, ok=(200, 201, 204)):
    url = API + path
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + AUTH)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8", "replace")
            return resp.status, (json.loads(body) if body.strip() else {})
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        if exc.code in ok:
            return exc.code, (json.loads(body) if body.strip() else {})
        print("ОШИБКА " + method + " " + path + " -> " + str(exc.code))
        print(body[:800])
        raise


def collect():
    files = []
    for base, dirs, names in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in names:
            full = os.path.join(base, name)
            rel = os.path.relpath(full, ROOT).replace("\\", "/")
            if name in SKIP_NAMES or name.lower().endswith(SKIP_EXT):
                continue
            if name in SECRET_HINTS:
                continue
            if rel.startswith((".zwork/", "build/")):
                continue
            # одноразовые скрипты работы с API доменного сервиса — не для публики
            if rel.startswith("deploy/od-"):
                continue
            with open(full, "rb") as fh:
                files.append((rel, fh.read(), name.lower().endswith((".sh", ".cmd"))))
    return files


def main():
    if not AUTH or not REPO or "/" not in REPO:
        print("Нужны GH_TOKEN и GH_REPO (вида owner/repo)")
        return 2

    print("1. Репозиторий " + REPO)
    status, info = call("GET", "/repos/" + REPO)
    print("   " + info.get("full_name", REPO) + ", visibility: " + str(info.get("visibility")))
    default_branch = info.get("default_branch") or BRANCH

    # Если в репозитории уже есть коммиты — берём их как основу
    head_sha = None
    base_tree = None
    status, ref = call("GET", "/repos/" + REPO + "/git/ref/heads/" + default_branch, ok=(200, 404, 409))
    if status == 200 and isinstance(ref, dict) and ref.get("object"):
        head_sha = ref["object"]["sha"]
        status, commit = call("GET", "/repos/" + REPO + "/git/commits/" + head_sha)
        base_tree = commit["tree"]["sha"]
        print("   базовая ветка " + default_branch + ": " + head_sha[:7])
    else:
        print("   репозиторий пустой — создам первый коммит через Contents API")
        # На совсем пустом репозитории Git Data API отвечает 409, поэтому первый
        # файл добавляем через Contents API — он создаст первый коммит и ветку.
        seed = b"# Volna\n"
        call(
            "PUT",
            "/repos/" + REPO + "/contents/.gitignore",
            {"message": "Первый коммит", "content": base64.b64encode(seed).decode("ascii")},
        )
        status, ref = call("GET", "/repos/" + REPO + "/git/ref/heads/" + default_branch, ok=(200, 404, 409))
        if status == 200 and isinstance(ref, dict) and ref.get("object"):
            head_sha = ref["object"]["sha"]
            status, commit = call("GET", "/repos/" + REPO + "/git/commits/" + head_sha)
            base_tree = commit["tree"]["sha"]
            print("   начальный коммит: " + head_sha[:7])

    files = collect()
    total = sum(len(c) for _, c, _ in files)
    print("2. Файлов к загрузке: " + str(len(files)) + ", " + str(round(total / 1048576, 2)) + " МБ")

    tree = []
    for rel, content, is_exec in files:
        status, blob = call(
            "POST",
            "/repos/" + REPO + "/git/blobs",
            {"content": base64.b64encode(content).decode("ascii"), "encoding": "base64"},
        )
        tree.append(
            {
                "path": rel,
                "mode": "100755" if is_exec else "100644",
                "type": "blob",
                "sha": blob["sha"],
            }
        )

    payload = {"tree": tree}
    if base_tree:
        payload["base_tree"] = base_tree
    status, new_tree = call("POST", "/repos/" + REPO + "/git/trees", payload)
    print("3. Дерево собрано: " + new_tree["sha"][:7])

    commit_payload = {"message": MESSAGE, "tree": new_tree["sha"]}
    if head_sha:
        commit_payload["parents"] = [head_sha]
    status, new_commit = call("POST", "/repos/" + REPO + "/git/commits", commit_payload)
    print("4. Коммит: " + new_commit["sha"][:7])

    if head_sha:
        status, _ = call(
            "PATCH",
            "/repos/" + REPO + "/git/refs/heads/" + default_branch,
            {"sha": new_commit["sha"], "force": False},
        )
    else:
        status, _ = call(
            "POST",
            "/repos/" + REPO + "/git/refs",
            {"ref": "refs/heads/" + default_branch, "sha": new_commit["sha"]},
        )
    print("5. Ветка " + default_branch + " обновлена")

    # Проверка результата: список файлов в репозитории
    status, check = call("GET", "/repos/" + REPO + "/git/trees/" + default_branch + "?recursive=1")
    paths = [t["path"] for t in check.get("tree", []) if t.get("type") == "blob"]
    bad = [p for p in paths if p.split("/")[-1] in SKIP_NAMES or p.startswith("voice-app/certs/")]
    print("6. В репозитории файлов: " + str(len(paths)))
    print("   запрещённых файлов: " + str(len(bad)) + (" -> " + ", ".join(bad) if bad else " (нет)"))
    print("")
    print("Готово: " + info.get("html_url", "https://github.com/" + REPO))
    return 0 if not bad else 1


if __name__ == "__main__":
    ssl_ctx = ssl.create_default_context()
    sys.exit(main())
