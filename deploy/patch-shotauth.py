"""Добавляет сценарий shotauth: снимок экрана входа (без тестовой сессии)."""
import io

PATH = "tools/volna-driver.mjs"
NEEDLE = "    if (scenario === 'shot') {"

BLOCK = """    if (scenario === 'shotauth') {
      await cdp.send('Page.navigate', { url: BASE + '/' });
      await sleep(2500);
      if (process.env.VOLNA_SHOT_W) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: Number(process.env.VOLNA_SHOT_W || 1280),
          height: Number(process.env.VOLNA_SHOT_H || 800),
          deviceScaleFactor: 1,
          mobile: false,
        });
        await sleep(800);
      }
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = join(process.cwd(), 'shot-auth-' + Date.now() + '.png');
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      const state = await cdp.eval("(() => ({ auth: !!document.querySelector('#authScreen') }))()", false);
      step('экран входа', { file, auth: state.auth });
      report.ok = !!state.auth;
    }

""" + NEEDLE

with io.open(PATH, encoding="utf-8") as fh:
    text = fh.read()

if "shotauth" in text:
    print("уже есть")
else:
    text = text.replace(NEEDLE, BLOCK, 1)
    with io.open(PATH, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("сценарий добавлен")
