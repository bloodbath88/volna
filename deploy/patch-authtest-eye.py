"""authtest: проверяем кнопку «показать пароль»."""
import io

PATH = "tools/volna-driver.mjs"
NEEDLE = "      step('до регистрации', before);"

BLOCK = """      const eye = await cdp.eval(`(() => {
        const box = document.querySelector('#authScreen');
        if (!box) return null;
        const input = box.querySelector('#authPass');
        const wrap = input.parentElement;
        const btn = wrap.querySelector('.pass-eye');
        if (!btn) return null;
        const first = input.type;
        btn.click();
        const shown = input.type;
        btn.click();
        return { first, shown, back: input.type, cls: wrap.className, btn: btn.className };
      })()`, false);
      step('показ пароля', eye);
""" + NEEDLE

with io.open(PATH, encoding="utf-8", newline="") as fh:
    text = fh.read()

if "показ пароля" in text:
    print("уже есть")
else:
    text = text.replace(NEEDLE, BLOCK, 1)
    text = text.replace(
        "report.ok = before.auth === true && after.auth === false",
        "report.ok = !!eye && eye.first === 'password' && eye.shown === 'text' && eye.back === 'password' && before.auth === true && after.auth === false",
        1,
    )
    with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    print("сценарий обновлён")
