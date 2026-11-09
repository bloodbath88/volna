# -*- coding: utf-8 -*-
"""
«Волна» — автоматические тесты по методологии скила webapp-testing
(anthropics/skills — самого популярного репозитория скилов на GitHub).

Запуск (сервер уже должен работать):
    python tests\\test_volna.py

Что проверяется:
  T1  экран входа открывается
  T2  регистрация снимает локальный замок
  T3  вход в комнату по ссылке-приглашению
  T4  категории каналов (текстовые/голосовые)
  T5  иконки каналов (# и 🔊)
  T6  живой счётчик участников
  T7  панель пользователя: имя
  T8  кнопки панели (3)
  T9  микрофон гаснет с панели (делегация в #micBtn)
  T10 переход в текстовый канал
  T11 возврат в голосовую
  T12 отправка сообщения в чат
  T13 консоль без ошибок страницы
"""
import base64
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = 'https://localhost:8443'
OUT = Path(__file__).resolve().parent.parent / 'preview'
OUT.mkdir(exist_ok=True)

RESULTS = []


def check(name, ok, detail=''):
    RESULTS.append((name, bool(ok), str(detail)))
    print(('  [OK]   ' if ok else '  [ПРОВАЛ] ') + name + ((' — ' + detail) if detail else ''))


def step(fn):
    def wrapped():
        try:
            fn()
        except Exception as exc:  # ошибка шага = провал теста, не падение сюита
            check(fn.__doc__ or fn.__name__, False, type(exc).__name__ + ': ' + str(exc)[:160])
    return wrapped


cfg = json.loads(Path('D:/Volna/voice-app/config.json').read_text(encoding='utf-8'))
room_code = base64.urlsafe_b64encode(
    json.dumps({'r': 'main', 'k': cfg['roomPassword']}, separators=(',', ':')).encode('utf-8')
).decode('ascii').rstrip('=')
INVITE = BASE + '/#i=' + room_code
ACCOUNT = 'qa-' + str(int(time.time()))



# ---- T14-T15: роли (модератор/участник) ----
def t14_roles(page):
    """T14 роль в ответе сервера"""
    try:
        cfg2 = json.loads(Path('D:/Volna/voice-app/config.json').read_text(encoding='utf-8'))
        admin = cfg2.get('adminPassword', '')
        if not admin:
            check('T14 роль в ответе сервера', True, 'пропущено: adminPassword не задан')
            return
        for who, key, expected in (('модератор', admin, 'moderator'), ('участник', cfg2['roomPassword'], 'participant')):
            body = '{"name":"qa-role","room":"main","password":"' + key + '"}'
            r = page.evaluate("(async () => { const r = await fetch('/api/token', {method:'POST', headers:{'Content-Type':'application/json'}, body: " + json.dumps(body) + "}); return JSON.stringify({s: r.status, j: await r.json()}); })()")
            j = json.loads(r)
            got = (j.get('j') or {}).get('role', '')
            check('T14 роль: ' + who, str(j.get('s')) == '200' and got == expected, 'статус ' + str(j.get('s')) + ', роль ' + str(got))
    except Exception as exc:
        check('T14 роль в ответе сервера', False, type(exc).__name__ + ': ' + str(exc)[:120])


def t15_moderator_crown(browser):
    """T15 корона модератора в панели"""
    try:
        cfg2 = json.loads(Path('D:/Volna/voice-app/config.json').read_text(encoding='utf-8'))
        admin = cfg2.get('adminPassword', '')
        if not admin:
            check('T15 корона модератора', True, 'пропущено: adminPassword не задан')
            return
        code2 = base64.urlsafe_b64encode(json.dumps({'r': 'main', 'k': admin}, separators=(',', ':')).encode()).decode().rstrip('=')
        url2 = BASE + '/?qa=' + str(int(time.time())) + '#i=' + code2
        ctx2 = browser.new_context(viewport={'width': 1440, 'height': 900}, ignore_https_errors=True)
        pg = ctx2.new_page()
        pg.goto(BASE + '/', wait_until='domcontentloaded')
        pg.wait_for_selector('#authScreen', timeout=20000)
        pg.click('[data-mode="up"]')
        pg.fill('#authLogin', 'qa-mod-' + str(int(time.time())))
        pg.fill('#authPass', 'qa-pass-2026')
        pg.fill('#authPass2', 'qa-pass-2026')
        pg.click('#authSubmit')
        pg.wait_for_timeout(2500)
        pg.goto(url2, wait_until='domcontentloaded')
        pg.wait_for_selector('#joinBtn', timeout=20000)
        pg.click('#joinBtn')
        pg.wait_for_function("document.documentElement.dataset.volnaRooms && document.documentElement.dataset.volnaRooms !== '0'", timeout=30000)
        time.sleep(4)
        crown = pg.locator('.cv-crown')
        visible = crown.count() == 1 and crown.first.is_visible()
        check('T15 корона модератора в панели', visible)
        ctx2.close()
    except Exception as exc:
        check('T15 корона модератора в панели', False, type(exc).__name__ + ': ' + str(exc)[:120])


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            channel='chrome',  # системный Chrome — без скачивания chromium
            args=[
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
                '--autoplay-policy=no-user-gesture-required',
            ],
        )
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, ignore_https_errors=True)
        page = ctx.new_page()
        console_errors = []
        page.on('pageerror', lambda e: console_errors.append('pageerror: ' + str(e)[:200]))
        page.on('console', lambda m: console_errors.append('console: ' + m.text[:200]) if m.type == 'error' else None)
        page.on('response', lambda r: console_errors.append('http %d: %s' % (r.status, r.url[:120])) if r.status >= 400 else None)

        # T1. Экран входа (reconnaissance-then-action: сначала осмотр)
        # NB: networkidle в этом приложении никогда не наступает (WebSocket-поллинг),
        # поэтому ждём domcontentloaded + явные селекторы (как советует сам скил:
        # «add appropriate waits: wait_for_selector»)
        def goto(url, selector):
            page.goto(url, wait_until='domcontentloaded')
            page.wait_for_selector(selector, timeout=20000)

        @step
        def t1():
            """T1 экран входа открывается"""
            goto(BASE + '/', '#authScreen')
            check('T1 экран входа открывается', page.locator('#authScreen').is_visible())
            page.screenshot(path=str(OUT / 't1-auth.png'))

        t1()

        # T2. Регистрация
        @step
        def t2():
            """T2 регистрация снимает локальный замок"""
            page.click('[data-mode="up"]')
            page.fill('#authLogin', ACCOUNT)
            page.fill('#authPass', 'qa-pass-2026')
            page.fill('#authPass2', 'qa-pass-2026')
            page.click('#authSubmit')
            page.wait_for_timeout(2500)
            check('T2 регистрация снимает замок', page.locator('#authScreen').count() == 0)

        t2()

        # T3. Вход по приглашению
        @step
        def t3():
            """T3 вход в комнату по приглашению"""
            # полная навигация (как настоящий переход по ссылке из мессенджера):
            # goto с отличающимся query — иначе это same-document переход и
            # обработчик приглашения не перезапускается
            goto(BASE + '/?qa=' + str(int(time.time())) + '#i=' + room_code, '#joinBtn')
            page.click('#joinBtn')
            page.wait_for_function(
                "document.documentElement.dataset.volnaRooms && document.documentElement.dataset.volnaRooms !== '0'",
                timeout=30000,
            )
            page.wait_for_timeout(2500)
            check('T3 вход в комнату по приглашению', True)
            page.screenshot(path=str(OUT / 't3-room.png'))

        t3()

        # T4-T6. Список каналов
        @step
        def t4():
            """T4-T6 категории, иконки, счётчик"""
            cats = page.locator('.cv-cat').all_text_contents()
            check('T4 категории каналов',
                  ('Текстовые каналы' in cats) and any('Голосовые' in c for c in cats), str(cats))
            icons = page.locator('.cv-ic').count()
            check('T5 иконки каналов (#/🔊)', icons >= 2, 'иконок: %d' % icons)
            live = page.locator('.chan-row[data-cv-live] .cv-count')
            try:
                live.wait_for(timeout=15000)  # счётчик обновляется раз в 5 с
            except Exception:
                pass
            count = live.first.text_content() if live.count() else ''
            check('T6 живой счётчик участников', str(count).strip() == '1', 'счётчик: ' + str(count))

        t4()

        # T7-T9. Панель пользователя
        @step
        def t7():
            """T7-T9 панель пользователя и микрофон"""
            name = (page.locator('.cv-user-name').text_content() or '').strip()
            check('T7 панель: имя пользователя', bool(name) and name != '…', 'имя: ' + name)
            check('T8 кнопки панели', page.locator('.cv-ub').count() == 3)
            page.locator('.cv-ub').first.click()
            page.wait_for_timeout(900)
            off = page.locator('#micBtn.is-off').count()
            check('T9 микрофон гаснет с панели', off == 1)
            page.locator('.cv-ub').first.click()
            page.wait_for_timeout(900)

        t7()

        # T10-T11. Переходы текст <-> голос
        @step
        def t10():
            """T10-T11 переходы между каналами"""
            page.locator('.cv-text-row').click()
            page.wait_for_timeout(4500)
            cur = page.evaluate('window.__volnaDebug ? __volnaDebug.currentRoom() : null')
            check('T10 переход в текстовый канал', cur == 'obshaya-perepiska', 'cur=' + str(cur))
            page.screenshot(path=str(OUT / 't10-text.png'))
            page.locator('.cv-voice-row').click()
            page.wait_for_timeout(7000)
            cur2 = page.evaluate('window.__volnaDebug ? __volnaDebug.currentRoom() : null')
            check('T11 возврат в голосовую', cur2 == 'main', 'cur=' + str(cur2))

        t10()

        # T12. Чат
        @step
        def t12():
            """T12 отправка сообщения в чат"""
            before = page.evaluate(
                "window.__volnaDebug && __volnaDebug.chat ? __volnaDebug.chat().messages : -1")
            box = page.locator('input[placeholder*="общение"], textarea[placeholder*="общение"]').first
            box.fill('Сообщение из автотестов')
            box.press('Enter')
            page.wait_for_timeout(2000)
            after = page.evaluate(
                "window.__volnaDebug && __volnaDebug.chat ? __volnaDebug.chat().messages : -2")
            check('T12 сообщение появилось в чате', after == before + 1,
                  'было %s, стало %s' % (before, after))

        t12()

        # T13. Консоль
        @step
        def t13():
            """T13 консоль без ошибок"""
            check('T13 консоль без ошибок страницы', len(console_errors) == 0,
                  ('ошибок: %d; первая: ' % len(console_errors)) + (console_errors[0] if console_errors else ''))

        t13()
        t14_roles(page)
        t15_moderator_crown(browser)

        browser.close()

    ok = [r for r in RESULTS if r[1]]
    print('')
    print('ИТОГ: %d из %d тестов прошли' % (len(ok), len(RESULTS)))
    for name, passed, detail in RESULTS:
        print(('  OK   ' if passed else '  FAIL ') + name + ((' — ' + detail) if detail else ''))
    return 0 if len(ok) == len(RESULTS) else 1


if __name__ == '__main__':
    sys.exit(main())
