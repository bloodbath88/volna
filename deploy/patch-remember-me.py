"""Убирает «Гость-N», добавляет «Запомнить меня» и автовход по сохранённому логину."""
import io

PATH = "voice-app/public/entry.js"

with io.open(PATH, encoding="utf-8", newline="") as fh:
    text = fh.read()

nl = "\r\n" if "\r\n" in text else "\n"
changes = 0


def swap(old, new, label):
    global text, changes
    if new in text:
        print("уже есть:", label)
        return
    if old not in text:
        print("НЕ НАЙДЕНО:", label)
        return
    text = text.replace(old, new, 1)
    changes += 1
    print("готово:", label)


# 1. Убираем случайное имя «Гость-N»: подставляем логин аккаунта
swap(
    "nameInput.value = store.get('name', '') || ('Гость-' + (1000 + Math.floor(Math.random() * 9000)));",
    "nameInput.value = store.get('name', '') || (typeof AUTH !== 'undefined' && AUTH.login ? AUTH.login : '');",
    "имя без «Гость-N»",
)

# 2. setSession учитывает галочку
swap(
    "  function setSession(login) {",
    "  function setSession(login, remember) {" + nl +
    "    try {" + nl +
    "      if (remember) localStorage.setItem('volna.remember', login);" + nl +
    "      else localStorage.removeItem('volna.remember');" + nl +
    "    } catch (e) { /* приватный режим */ }",
    "подпись setSession",
)

swap(
    "store.set('session', JSON.stringify({ login: login, until: Date.now() + 30 * 86400000 }));",
    "store.set('session', JSON.stringify({ login: login, until: Date.now() + (remember ? 365 : 1) * 86400000, remember: !!remember }));",
    "срок сессии по галочке",
)

# 3. Выход забывает и сохранённый логин
swap(
    "  function dropSession() {" + nl + "    store.set('session', '');",
    "  function dropSession() {" + nl +
    "    store.set('session', '');" + nl +
    "    try { localStorage.removeItem('volna.remember'); } catch (e) { /* уже пусто */ }",
    "выход чистит память",
)

# 4. Галочка в карточке входа
swap(
    "      '  <p class=\"auth-error\" id=\"authError\"></p>',",
    "      '  <label class=\"auth-remember\"><input type=\"checkbox\" id=\"authRemember\" checked>'," + nl +
    "      '    <span>Запомнить меня — входить автоматически</span></label>'," + nl +
    "      '  <p class=\"auth-error\" id=\"authError\"></p>',",
    "галочка в разметке",
)

# 5. Подставляем сохранённый логин в поле
swap(
    "    const pass2Field = box.querySelector('#authPass2Field');",
    "    const pass2Field = box.querySelector('#authPass2Field');" + nl +
    "    try {" + nl +
    "      const savedLogin = localStorage.getItem('volna.remember') || '';" + nl +
    "      if (savedLogin) box.querySelector('#authLogin').value = savedLogin;" + nl +
    "    } catch (e) { /* приватный режим */ }",
    "подстановка логина",
)

# 6. Обе ветки входа/регистрации передают галочку
swap(
    "        saveUsers(users);" + nl + "        setSession(login);",
    "        saveUsers(users);" + nl +
    "        setSession(login, box.querySelector('#authRemember').checked);",
    "регистрация с галочкой",
)

swap(
    "        if (hash !== users[login].hash) { err.textContent = 'Неверный пароль'; return; }" + nl + "        setSession(login);",
    "        if (hash !== users[login].hash) { err.textContent = 'Неверный пароль'; return; }" + nl +
    "        setSession(login, box.querySelector('#authRemember').checked);",
    "вход с галочкой",
)

# 7. Автовход при сохранённом логине
swap(
    "  function guardAuth() {" + nl +
    "    const session = currentSession();" + nl +
    "    if (session) { AUTH.login = session.login; return; }" + nl +
    "    showAuthScreen();",
    "  function guardAuth() {" + nl +
    "    const session = currentSession();" + nl +
    "    if (session) { AUTH.login = session.login; return; }" + nl +
    "    let remembered = '';" + nl +
    "    try { remembered = localStorage.getItem('volna.remember') || ''; } catch (e) { remembered = ''; }" + nl +
    "    if (remembered && usersMap()[remembered]) {" + nl +
    "      setSession(remembered, true);" + nl +
    "      toast('Вы вошли автоматически как ' + remembered);" + nl +
    "      return;" + nl +
    "    }" + nl +
    "    showAuthScreen();",
    "автовход по сохранённому логину",
)

# 8. Имя в форме комнаты = логин аккаунта
swap(
    "  function setHostName() {",
    "  function prefillJoinName() {" + nl +
    "    const input = $('#nameInput');" + nl +
    "    if (!input) return;" + nl +
    "    if ((input.value || '').trim()) return;" + nl +
    "    if (AUTH.login) input.value = AUTH.login;" + nl +
    "  }" + nl + nl +
    "  function setHostName() {",
    "функция prefillJoinName",
)

swap(
    "    guardAuth();",
    "    guardAuth();" + nl + "    prefillJoinName();",
    "вызов prefillJoinName",
)

with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
    fh.write(text)

print("изменений:", changes)
