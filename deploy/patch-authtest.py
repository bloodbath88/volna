"""Сценарий authtest: открываем страницу без тестовой сессии, чтобы увидеть экран входа."""
import io

PATH = "tools/volna-driver.mjs"
OLD = """    if (scenario === 'authtest') {
      // без сохранённой сессии должен быть экран входа, регистрация — пускать внутрь
      await open();
      await sleep(1200);"""
NEW = """    if (scenario === 'authtest') {
      // без сохранённой сессии должен быть экран входа, регистрация — пускать внутрь
      await cdp.send('Page.navigate', { url: BASE + '/' });
      await sleep(2500);"""

with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

if OLD in text:
    text = text.replace(OLD, NEW, 1)
    with io.open(PATH, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("сценарий обновлён")
else:
    print("шаблон не найден")
