"""Разбирает строку «ICE candidate pair stats» из журнала LiveKit и печатает пары."""
import json
import sys

path = sys.argv[1]
raw = ""
# PowerShell 5.1 при перенаправлении пишет UTF-16 — пробуем по очереди
for enc in ("utf-8-sig", "utf-16", "cp1251"):
    try:
        with open(path, encoding=enc) as handle:
            candidate = handle.read()
        if "room" in candidate:
            raw = candidate
            break
    except Exception:
        continue
if not raw:
    print("не удалось прочитать файл")
    raise SystemExit(1)
# вывод ssh-инструмента приходит с экранированными кавычками — возвращаем как было
raw = raw.replace('\\"', '"')
start = raw.find('{"room"')
if start < 0:
    print("строка со статистикой не найдена")
    raise SystemExit(1)
end = raw.rfind("}")
obj = json.loads(raw[start:end + 1])

for pair in obj.get("stats", []):
    print(
        pair.get("state"),
        "| local", pair.get("local"),
        "| remote", pair.get("remote"),
        "| sent", pair.get("requestsSent"),
        "recv", pair.get("requestsReceived"),
        "respRx", pair.get("responsesReceived"),
        "respTx", pair.get("responsesSent"),
    )
