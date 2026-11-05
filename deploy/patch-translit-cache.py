"""1) Транслит кириллицы в имени комнаты. 2) Сброс кэша приложения не чаще раза в сутки."""
import io

ENTRY = "voice-app/public/entry.js"
MAIN = "voice-app/desktop/main.js"

# --- 1. транслит ---
with io.open(ENTRY, encoding="utf-8", newline="") as fh:
    text = fh.read()

nl = "\r\n" if "\r\n" in text else "\n"

TRANSLIT = (
    "  const TRANSLIT = { а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ё:'e', ж:'zh', з:'z', и:'i', й:'y',"
    " к:'k', л:'l', м:'m', н:'n', о:'o', п:'p', р:'r', с:'s', т:'t', у:'u', ф:'f', х:'h', ц:'c',"
    " ч:'ch', ш:'sh', щ:'sch', ъ:'', ы:'y', ь:'', э:'e', ю:'yu', я:'ya' };" + nl + nl
)

if "const TRANSLIT" not in text:
    anchor = "  function cleanRoomName(raw) {"
    text = text.replace(anchor, TRANSLIT + anchor, 1)
    print("транслит добавлен")

old_chain = "      .replace(/[^a-z0-9а-яё._~-]/gi, '-')"
new_chain = (
    "      .replace(/[а-яё]/gi, (ch) => TRANSLIT[ch.toLowerCase()] || '')" + nl +
    "      .replace(/[^a-z0-9._~-]/gi, '-')"
)
if new_chain not in text:
    text = text.replace(old_chain, new_chain, 1)
    print("кириллица транслитерируется в имени комнаты")

with io.open(ENTRY, "w", encoding="utf-8", newline="") as fh:
    fh.write(text)

# --- 2. кэш не чаще раза в сутки ---
with io.open(MAIN, encoding="utf-8", newline="") as fh:
    main = fh.read()

old_block = "    try { await session.defaultSession.clearCache(); } catch (e) { /* кэш уже пуст */ }"
new_block = (
    "    try {" + nl +
    "      const stampFile = path.join(app.getPath('userData'), 'cache-stamp.json');" + nl +
    "      let last = 0;" + nl +
    "      try { last = Number(JSON.parse(require('fs').readFileSync(stampFile, 'utf8')).at || 0); } catch (e) { last = 0; }" + nl +
    "      if (Date.now() - last > 24 * 3600 * 1000) {" + nl +
    "        await session.defaultSession.clearCache();" + nl +
    "        require('fs').writeFileSync(stampFile, JSON.stringify({ at: Date.now() }));" + nl +
    "      }" + nl +
    "    } catch (e) { /* кэш не критичен для запуска */ }"
)

if new_block in main:
    print("кэш уже по расписанию")
else:
    main = main.replace(old_block, new_block, 1)
    with io.open(MAIN, "w", encoding="utf-8", newline="") as fh:
        fh.write(main)
    print("кэш: сброс не чаще раза в сутки")
