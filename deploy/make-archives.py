"""Собирает архивы релиза «Волны»: zip для Windows и tar.gz для Linux.

Состав повторяет прошлые сборки: папка `volna/` со всем приложением и готовыми
библиотеками, но без секретов и машинных файлов — config.json, сертификатов,
скачанных бинарников и журналов. Имена только латиницей (tar.exe в Windows
портит кириллицу), .sh — с переводами строк LF и без BOM.
"""
import os
import tarfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "voice-app")
OUT_ZIP = os.path.join(ROOT, "volna-voice-app.zip")
OUT_TAR = os.path.join(ROOT, "volna-voice-app-linux.tar.gz")

EXCLUDE_DIRS = {"runtime", "certs", "run", ".zwork", "__pycache__"}
EXCLUDE_FILES = {
    "config.json",
    "addresses.json",
    "livekit.yaml",
    "livekit-server.exe",
    "livekit.zip",
    "udp-mapping.txt",
}
EXCLUDE_EXT = (".log", ".pid", ".pyc", ".zip")


def collect():
    """Пути файлов относительно voice-app, отсортированные для повторяемости."""
    found = []
    for base, dirs, names in os.walk(APP):
        rel_base = os.path.relpath(base, APP).replace("\\", "/")
        if rel_base == ".":
            rel_base = ""
        keep_dirs = []
        for name in dirs:
            if name in EXCLUDE_DIRS:
                continue
            # библиотеки Electron весят сотни мегабайт — их скачивает install-desktop
            if name == "node_modules" and rel_base == "desktop":
                continue
            keep_dirs.append(name)
        dirs[:] = keep_dirs
        for name in names:
            if name in EXCLUDE_FILES or name.lower().endswith(EXCLUDE_EXT):
                continue
            full = os.path.join(base, name)
            rel = os.path.relpath(full, APP).replace("\\", "/")
            found.append(rel)
    return sorted(found)


def read_bytes(rel):
    with open(os.path.join(APP, rel), "rb") as fh:
        data = fh.read()
    if rel.endswith(".sh"):
        if data.startswith(b"\xef\xbb\xbf"):
            data = data[3:]
        data = data.replace(b"\r\n", b"\n")
    return data


def main():
    files = collect()
    print("Файлов в сборке: " + str(len(files)))

    with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for rel in files:
            zf.writestr("volna/" + rel, read_bytes(rel))

    with tarfile.open(OUT_TAR, "w:gz", compresslevel=9) as tf:
        for rel in files:
            data = read_bytes(rel)
            info = tarfile.TarInfo("volna/" + rel)
            info.size = len(data)
            info.mtime = 1760000000
            info.mode = 0o755 if rel.endswith((".sh", ".cmd")) else 0o644
            import io

            tf.addfile(info, io.BytesIO(data))

    for path in (OUT_ZIP, OUT_TAR):
        size = os.path.getsize(path)
        print("  " + os.path.basename(path) + ": " + str(round(size / 1048576, 2)) + " МБ")


if __name__ == "__main__":
    main()
