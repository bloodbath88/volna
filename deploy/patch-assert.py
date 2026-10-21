"""Обновляет проверку сценария subcreate: важны отрисованные участники, а не отсутствие экрана входа."""
import io

PATH = "tools/volna-driver.mjs"
OLD = "after.title === 'Volna' && !seenJoin && after.chatVisible"
NEW = "after.title === 'Volna' && after.chatVisible && people.people === 1 && people.tiles === 1"

with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

if OLD in text:
    text = text.replace(OLD, NEW, 1)
    with io.open(PATH, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("обновлено")
else:
    print("шаблон не найден:", OLD in text)
