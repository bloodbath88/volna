"""Сценарий remember: очистка → регистрация с галочкой → перезагрузка → автовход."""
import io

PATH = "tools/volna-driver.mjs"
NEEDLE = "    if (scenario === 'shotauth') {"

BLOCK = r"""    if (scenario === 'remember') {
      await cdp.send('Page.navigate', { url: BASE + '/' });
      await sleep(1600);
      await cdp.eval("(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} return true; })()", false);
      await cdp.send('Page.reload');
      await sleep(2400);

      const first = await cdp.eval("(() => ({ auth: !!document.querySelector('#authScreen'), remember: !!document.querySelector('#authRemember'), checked: (document.querySelector('#authRemember') || {}).checked, name: (document.querySelector('#nameInput') || {}).value }))()", false);
      step('после очистки', first);

      const regIn = await cdp.eval(`(() => {
        const login = document.querySelector('#authLogin');
        const pass = document.querySelector('#authPass');
        const pass2 = document.querySelector('#authPass2');
        const up = document.querySelector('[data-mode="up"]');
        if (up) up.click();
        login.value = 'remember1';
        pass.value = 'secret123';
        if (pass2) pass2.value = 'secret123';
        document.querySelector('#authSubmit').click();
        return { ok: true };
      })()`, false);
      step('заполнил регистрацию', regIn);
      await sleep(2000);

      const reg = await cdp.eval("(() => ({ auth: !!document.querySelector('#authScreen'), name: (document.querySelector('#nameInput') || {}).value }))()", false);
      step('после регистрации', reg);

      await cdp.send('Page.reload');
      await sleep(2600);
      const again = await cdp.eval("(() => ({ auth: !!document.querySelector('#authScreen'), name: (document.querySelector('#nameInput') || {}).value, saved: !!localStorage.getItem('volna.remember') }))()", false);
      step('после перезагрузки', again);

      report.ok = !!first.auth && first.checked === true && reg.auth === false && again.auth === false && again.saved === true && again.name === 'remember1';
    }

""" + NEEDLE

with io.open(PATH, encoding="utf-8", newline="") as fh:
    text = fh.read()

if "scenario === 'remember'" in text:
    print("уже есть")
else:
    text = text.replace(NEEDLE, BLOCK, 1)
    with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    print("сценарий добавлен")
