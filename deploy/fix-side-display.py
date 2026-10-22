"""Разрешает показ правой колонки (снимает display:none !important)."""
import io

PATH = "voice-app/public/styles.css"
with io.open(PATH, encoding="utf-8", newline="") as fh:
    css = fh.read()

old = ".side{display:none !important}"
new = ".side{display:none}"

if old in css:
    css = css.replace(old, new, 1)
    print("правило .side ослаблено")

css = css.replace(".side:empty{display:none}", ".side:empty{display:none !important}", 1)
css = css.replace("  .side{display:none}\n}", "  .side{display:none !important}\n}", 1)

with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
    fh.write(css)

print("готово")
