"""Перебивает имя «Гость-N», которое ставит app.js при загрузке."""
import io

PATH = "voice-app/public/entry.js"
with io.open(PATH, encoding="utf-8", newline="") as fh:
    text = fh.read()

old = """  function prefillJoinName() {
    const input = $('#nameInput');
    if (!input) return;
    if ((input.value || '').trim()) return;
    if (AUTH.login) input.value = AUTH.login;
  }"""

new = """  function prefillJoinName() {
    const input = $('#nameInput');
    if (!input || !AUTH.login) return;
    const apply = () => {
      if (!input.value || /^Гость-\\d+$/i.test(input.value)) input.value = AUTH.login;
    };
    apply();
    // app.js выставляет «Гость-N» при своей инициализации — перебиваем несколько раз
    let ticks = 0;
    const timer = setInterval(() => {
      apply();
      if (++ticks > 20) clearInterval(timer);
    }, 400);
  }"""

if "ticks > 20" in text:
    print("уже есть")
else:
    if old not in text:
        raise SystemExit("prefillJoinName не найден в ожидаемом виде")
    text = text.replace(old, new, 1)
    with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    print("перебили имя гостя")
