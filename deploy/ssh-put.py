#!/usr/bin/env python
"""
Копирует файл на сервер по SSH — только по ключу deploy/volna_deploy_key.

  python deploy/ssh-put.py --host 1.2.3.4 --local volna.tar.gz --remote /root/volna.tar.gz
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
    parser.add_argument("--local", required=True)
    parser.add_argument("--remote", required=True)
    args = parser.parse_args()

    if not os.path.exists(args.local):
        print("Нет файла " + args.local)
        return 2

    client = connect(args.host, args.user, args.port)
    sftp = client.open_sftp()
    size = os.path.getsize(args.local)
    print("Копирую " + args.local + " (" + str(round(size / 1048576, 2)) + " МБ) -> " + args.remote)
    sftp.put(args.local, args.remote)
    sftp.close()
    stdin, stdout, stderr = client.exec_command("ls -lh " + args.remote)
    print(stdout.read().decode("utf-8", "replace").strip())
    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
