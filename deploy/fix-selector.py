"""Заменяет устаревший селектор кнопки создания комнаты в драйвере."""
import io

PATH = "tools/volna-driver.mjs"
OLD = "document.querySelector('[data-volna-action=\"new-room\"]').click()"
NEW = "document.querySelector('#channelList .chan-add').click()"

with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

count = text.count(OLD)
text = text.replace(OLD, NEW)

with io.open(PATH, "w", encoding="utf-8") as fh:
    fh.write(text)

print("заменено вхождений:", count)
