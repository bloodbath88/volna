#!/usr/bin/env python
"""Проверка обратного UDP: узнаём свой внешний адрес через STUN и ждём пакет с сервера."""
import os
import socket
import struct


def mapping(sock):
    tid = os.urandom(12)
    sock.sendto(struct.pack("!HHI", 1, 0, 0x2112A442) + tid, ("stun.l.google.com", 19302))
    data, _ = sock.recvfrom(1024)
    i = 20
    while i + 4 <= len(data):
        t, ln = struct.unpack("!HH", data[i:i + 4])
        if t == 0x0020:
            port = struct.unpack("!H", data[i + 6:i + 8])[0] ^ 0x2112
            ip = bytes(b ^ m for b, m in zip(data[i + 8:i + 12], [0x21, 0x12, 0xA4, 0x42]))
            return ".".join(str(x) for x in ip), port
        i += 4 + ln + ((4 - ln % 4) % 4)
    raise RuntimeError("нет XOR-MAPPED-ADDRESS")


s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.settimeout(5)
ip, port = mapping(s)
print("MAPPING %s:%s" % (ip, port), flush=True)
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "udp-mapping.txt"), "w") as fh:
    fh.write("%s:%s" % (ip, port))

s.settimeout(45)
try:
    data, addr = s.recvfrom(2048)
    print("REPLY from %s: %r" % (addr, data[:40]), flush=True)
except Exception as exc:
    print("NO REPLY (%s)" % type(exc).__name__, flush=True)
