#!/usr/bin/env python
"""
«Волна» — развёртывание на VPS по SSH (через paramiko, без внешнего ssh-клиента).

Что делает по шагам:
  1. подключается ключом и показывает, что за сервер (ОС, ядро, права);
  2. проверяет, что домен уже указывает на этот сервер;
  3. заливает архив volna-voice-app-linux.tar.gz и распаковывает в /opt/volna;
  4. запускает install-vps.sh с доменом и e-mail (пакеты, ufw, Node.js, LiveKit,
     сертификат Let's Encrypt, режим сервера, systemd);
  5. проверяет снаружи: /api/health, заголовок страницы, состояние службы и сертификат;
  6. печатает итог, включая пароль комнаты из вывода установщика.

Пример:
  python deploy/deploy.py --host 203.0.113.10 --user root \
      --domain volna.qzz.io --email me@example.com
"""

import argparse
import os
import re
import shlex
import socket
import ssl
import sys
import time
import urllib.request

import paramiko

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def connect(host, user, key_path, port=22):
    key = paramiko.Ed25519Key.from_private_key_file(key_path)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        host,
        port=port,
        username=user,
        pkey=key,
        timeout=20,
        banner_timeout=30,
        auth_timeout=30,
        look_for_keys=False,
        allow_agent=False,
    )
    return client


def run(client, command, timeout=180, sudo=False, stdin_text=None, label=""):
    full = ("sudo -n bash -lc " + shlex.quote(command)) if sudo else command
    stdin, stdout, stderr = client.exec_command(full, timeout=timeout)
    if stdin_text:
        try:
            stdin.write(stdin_text)
            stdin.flush()
        except Exception:
            pass
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    print("--- " + (label or command[:70]) + "  [код " + str(code) + "]")
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print("STDERR: " + err.rstrip())
    return code, out, err


def https_get(url, timeout=15):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers={"User-Agent": "volna-deploy"})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        return resp.status, resp.read(4000).decode("utf-8", "replace")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", required=True, help="IP или имя сервера")
    parser.add_argument("--user", default="root")
    parser.add_argument("--port", type=int, default=22)
    parser.add_argument("--domain", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--key", default=os.path.join(ROOT, "deploy", "volna_deploy_key"))
    parser.add_argument("--archive", default=os.path.join(ROOT, "volna-voice-app-linux.tar.gz"))
    parser.add_argument("--dir", default="/opt/volna")
    parser.add_argument("--skip-install", action="store_true", help="только залить и распаковать")
    args = parser.parse_args()

    if not os.path.exists(args.key):
        print("Нет файла ключа: " + args.key)
        return 2
    if not os.path.exists(args.archive):
        print("Нет архива: " + args.archive)
        return 2

    print("1. Проверяю DNS: " + args.domain)
    try:
        resolved = socket.gethostbyname(args.domain)
        print("   домен указывает на " + resolved)
        if resolved != args.host:
            print("   ВНИМАНИЕ: это не " + args.host + " — сертификат может не выпуститься")
    except Exception as exc:
        print("   домен пока не разрешается (" + str(exc) + ") — сертификат выпустить не получится")

    print("2. Подключаюсь по SSH к " + args.user + "@" + args.host)
    client = connect(args.host, args.user, args.key, args.port)
    try:
        run(client, "uname -srm; cat /etc/os-release | head -2; id -u; command -v sudo || true", label="сервер")

        print("3. Заливаю архив (" + str(round(os.path.getsize(args.archive) / 1048576, 1)) + " МБ)")
        sftp = client.open_sftp()
        sftp.put(args.archive, "/tmp/volna.tar.gz")
        sftp.close()
        run(client, "ls -lh /tmp/volna.tar.gz", label="файл на сервере")

        print("4. Распаковываю в " + args.dir)
        run(
            client,
            "mkdir -p {d} && tar -xzf /tmp/volna.tar.gz -C {d} --strip-components=1 && chmod +x {d}/*.sh && ls -1 {d}".format(d=args.dir),
            sudo=True,
            label="распаковка",
        )

        if args.skip_install:
            print("Готово (установка пропущена по --skip-install)")
            return 0

        print("5. Запускаю установщик — это 3–5 минут (пакеты, Node.js, LiveKit, сертификат, systemd)")
        code, out, err = run(
            client,
            "cd {d} && ./install-vps.sh --domain {domain} --email {email}".format(d=args.dir, domain=args.domain, email=args.email),
            sudo=True,
            timeout=900,
            stdin_text="д\n",
            label="install-vps.sh",
        )

        print("6. Проверяю службу и сертификат")
        run(client, "systemctl is-active volna; systemctl --no-pager -l status volna | head -14", label="служба")
        run(client, "ss -ltnp 2>/dev/null | grep -E ':(80|443|8443)' || true; ufw status 2>/dev/null | head -12 || true", sudo=True, label="порты")

        print("7. Проверяю снаружи")
        base = "https://" + args.domain
        try:
            status, body = https_get(base + "/api/health")
            print("   " + base + "/api/health -> " + str(status) + " " + body.strip()[:120])
        except Exception as exc:
            print("   health не отвечает: " + str(exc))
        try:
            status, body = https_get(base + "/")
            m = re.search(r"<title>(.*?)</title>", body, re.S)
            print("   главная страница -> " + str(status) + ", title: " + (m.group(1).strip() if m else "?"))
        except Exception as exc:
            print("   главная страница не открылась: " + str(exc))

        pwd = ""
        for line in out.splitlines():
            if "Пароль комнаты" in line:
                pwd = line.strip()
        print("")
        print("ИТОГ:")
        if pwd:
            print("   " + pwd)
        print("   адрес: " + base)
        print("   установщик завершился с кодом " + str(code))
        return 0 if code == 0 else 1
    finally:
        try:
            client.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
