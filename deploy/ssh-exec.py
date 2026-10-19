#!/usr/bin/env python
"""
Выполняет команду на сервере по SSH — только по ключу deploy/volna_deploy_key.

  python deploy/ssh-exec.py --host 1.2.3.4 --user root --command "uname -a"
"""

import argparse
import os
import sys

import paramiko

KEY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "volna_deploy_key")


def connect(host, user, port):
    if not os.path.exists(KEY_PATH):
        raise FileNotFoundError("нет файла ключа: " + KEY_PATH)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        host,
        port=port,
        username=user,
        pkey=paramiko.Ed25519Key.from_private_key_file(KEY_PATH),
        timeout=25,
        banner_timeout=30,
        auth_timeout=30,
        look_for_keys=False,
        allow_agent=False,
    )
    return client


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", required=True)
    parser.add_argument("--user", default="root")
    parser.add_argument("--port", type=int, default=22)
    parser.add_argument("--command", required=True)
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()

    try:
        client = connect(args.host, args.user, args.port)
    except Exception as exc:
        print("НЕ УДАЛОСЬ ПОДКЛЮЧИТЬСЯ: " + type(exc).__name__ + ": " + str(exc))
        return 2

    stdin, stdout, stderr = client.exec_command(args.command, timeout=args.timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print("STDERR: " + err.rstrip())
    client.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
