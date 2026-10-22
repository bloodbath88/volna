"""Дописывает в памятку сведения о настольном приложении на домене."""
import io

PATH = "deploy/UI-STATE.md"
BLOCK = """
## Настольное приложение на домене (22.10.2026)

- Настройки: `%APPDATA%\\Volna\\remote.json` → `{"url":"https://volna.is-cool.dev","hash":"<код приглашения main>"}`.
  Второй вариант — `voice-app/desktop/remote.json` (в репозиторий не попадает, добавлен в .gitignore).
- Если файл есть, Electron грузит домен и НЕ запускает локальный сервер; если нет — работает по-старому через localhost.
- Проверено: окно открывает https://volna.is-cool.dev, комната подключена, плитка 1, пинг 63 мс, локальных node/livekit процессов 0.
- Ярлык «Волна» на рабочем столе использует тот же exe и папку desktop — переключается автоматически.
- Код приглашения main: `eyJyIjoibWFpbiIsImsiOiJ2b2xuYS0yNDg3In0`.
- Релиз: v1.6.1.
"""

with io.open(PATH, "a", encoding="utf-8") as fh:
    fh.write(BLOCK)

print("дописано")
