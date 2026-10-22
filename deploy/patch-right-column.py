"""Правая колонка с друзьями + защита от кэша в настольном приложении."""
import io

CSS_PATH = "voice-app/public/styles.css"
CSS_BLOCK = """
/* в”Ђв”Ђ правая колонка: друзья в”Ђв”Ђ */
.room{grid-template-columns:250px minmax(0,1fr) 250px;grid-template-areas:"top top top" "chan stage side" "ctl ctl ctl"}
.side{grid-area:side;display:flex;flex-direction:column;gap:10px;min-height:0;overflow:hidden}
.side:empty{display:none}
.side-block{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);display:flex;flex-direction:column;min-height:0;overflow:hidden}
#friendsBox{flex:1 1 auto;min-height:0}
#friendsBox .friends-list{flex:1 1 auto;min-height:0;overflow:auto;padding:4px 6px 8px}
@media (max-width:1050px){
  .room{grid-template-columns:230px minmax(0,1fr);grid-template-areas:"top top" "chan stage" "ctl ctl"}
  .side{display:none}
}
"""

with io.open(CSS_PATH, encoding="utf-8", newline="") as fh:
    css = fh.read()

if ".side-block" not in css:
    with io.open(CSS_PATH, "a", encoding="utf-8", newline="") as fh:
        fh.write(CSS_BLOCK)
    print("стили правой колонки добавлены")
else:
    print("стили уже есть")

MAIN_PATH = "voice-app/desktop/main.js"
with io.open(MAIN_PATH, encoding="utf-8", newline="") as fh:
    main = fh.read()

if "clearCache" in main:
    print("сброс кэша уже есть")
else:
    if "const { app, BrowserWindow" in main:
        main = main.replace("const { app, BrowserWindow", "const { app, session, BrowserWindow", 1)
        print("session подключён")
    needle = "    if (REMOTE) {"
    if needle in main:
        main = main.replace(
            needle,
            "    try { await session.defaultSession.clearCache(); } catch (e) { /* кэш уже пуст */ }\n"
            "    try { await session.defaultSession.clearStorageData({ storages: ['serviceworkers'] }); } catch (e) {}\n\n"
            + needle,
            1,
        )
        print("сброс кэша вставлен")
    with io.open(MAIN_PATH, "w", encoding="utf-8", newline="") as fh:
        fh.write(main)
