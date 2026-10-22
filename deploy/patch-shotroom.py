"""Сценарий shotroom: снимок комнаты с правой колонкой друзей."""
import io

PATH = "tools/volna-driver.mjs"
NEEDLE = "    if (scenario === 'shotauth') {"

BLOCK = r"""    if (scenario === 'shotroom') {
      await open();
      await fill();
      await cdp.eval(clickJoin, false);
      const room = await waitFor(cdp, inRoom, 30000, 500);
      step('вошли в комнату', { roomVisible: room.roomVisible });
      await sleep(1200);
      if (process.env.VOLNA_SHOT_W) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: Number(process.env.VOLNA_SHOT_W || 1280),
          height: Number(process.env.VOLNA_SHOT_H || 800),
          deviceScaleFactor: 1,
          mobile: false,
        });
        await sleep(900);
      }
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = join(process.cwd(), 'shot-room-' + Date.now() + '.png');
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      const layout = await cdp.eval(`(() => {
        const side = document.querySelector('.side');
        const box = document.querySelector('#friendsBox');
        const stage = document.querySelector('.stage');
        const r = (el) => el ? el.getBoundingClientRect() : null;
        return {
          hasSide: !!side,
          friendsInSide: !!(side && box && side.contains(box)),
          sideWidth: side ? Math.round(r(side).width) : 0,
          sideLeft: side ? Math.round(r(side).left) : 0,
          stageRight: stage ? Math.round(r(stage).right) : 0,
          friendsVisible: !!box && r(box).width > 0,
        };
      })()`, false);
      step('правая колонка', layout);
      report.ok = layout.friendsInSide && layout.sideWidth > 120 && layout.friendsVisible;
    }

""" + NEEDLE

with io.open(PATH, encoding="utf-8", newline="") as fh:
    text = fh.read()

if "scenario === 'shotroom'" in text:
    print("уже есть")
else:
    text = text.replace(NEEDLE, BLOCK, 1)
    with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    print("сценарий добавлен")
