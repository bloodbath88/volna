# Volna — self-hosted voice rooms with screen sharing

A self-hosted voice room for 15–20 people: voice, screen sharing (including games),
sub-rooms, text chat with file transfer, friends and text-only rooms.
The media core is [LiveKit](https://livekit.io) (SFU), the server is Node.js,
the client is a web page plus a Windows desktop app (Electron).

No clouds, no accounts, no paid APIs: everything runs on your own computer or your own VPS.

## Features

- **Voice** — Opus 48 kHz, echo cancellation, noise gate; automatic reconnects.
- **Screen sharing** — whole screen, a window or a browser tab, with system audio.
  Four quality profiles: documents/slides (sharp text), 1080p60, 720p60 (low bandwidth), 1440p60.
- **Sub-rooms** — separate voice + separate chat per sub-room, created with one click
  right inside the call; a nested channel list, switching with a single click.
- **Chat** — always visible next to the participants, per room, with file attachments
  of any type (drag & drop, up to 8 MB) and image previews.
- **Invites** — one link contains the server address and the room password; the guest
  lands in the room without typing anything.
- **Privacy** — no registration, no personal data, anonymous mode, “forget everything” button.
- **Desktop app** — its own window without a browser bar, start menu shortcut,
  starts and stops the local server automatically.
- **TURN included** — for strict networks (symmetric NAT, mobile CGNAT) the server runs
  coturn and the client picks the relay automatically when a direct path is impossible.

## Repository layout

```
voice-app/                 the application itself
  server/                  HTTPS server: static files, access tokens, LiveKit signalling proxy
  public/                  client: app.js (rooms and audio), entry.js (join, menu, chat, privacy)
  public/bg/               interface background artwork
  desktop/                 desktop app (Electron): own window without the browser chrome
  start.cmd / start.sh     launcher (Windows / Linux)
  install-vps.sh           one-command install on a Linux VPS
  README.md                detailed host guide (Russian)
  SCENARIOS.md             two deployment scenarios: local network and VPS (Russian)
  PRIVACY.md               what is stored and what is not (Russian)
  PROJECT-HANDOVER.md      technical documentation for developers (Russian)
tools/                     headless-Chrome test driver (27 scenarios) and an HTTP preview mirror
deploy/                    VPS deployment scripts, release tooling, domain notes
REPORT-IMPROVEMENTS.md     what was changed and how it was verified (Russian)
```

> Application documentation is written in Russian; this page is the English entry point.

## Quick start (Windows)

1. Unpack `voice-app` anywhere, for example `C:\Volna`.
2. Double-click `start.cmd` — the first run downloads Node.js and the LiveKit server,
   creates a certificate and the configuration, starts the server and opens the window.
3. `firewall.cmd` as administrator — allow the ports for other devices on your network.
4. `create-shortcut.cmd` — desktop shortcuts.
5. `desktop\install-desktop.cmd` — the desktop app (own window, Start menu icon).

Invite people with the **“Invite”** button: the copied link already contains the address
and the room password, so the guest connects automatically.

## Quick start (Linux VPS)

```bash
mkdir -p volna && tar -xzf volna-voice-app-linux.tar.gz -C volna --strip-components=1
cd volna && chmod +x *.sh
sudo ./install-vps.sh --domain voice.example.com --email me@example.com
```

The installer sets up packages, the firewall, Node.js and LiveKit, issues a Let's Encrypt
certificate, switches the app to port 443 and creates a systemd service with autostart.

## Ports

| Port | Protocol | Purpose |
|---|---|---|
| 443 / 8443 | TCP | Web interface and signalling |
| 7881 | TCP | Media fallback when UDP is blocked |
| 7882 | UDP | Voice and screen sharing (WebRTC) |
| 3478 | UDP/TCP | TURN itself (strict networks) |
| 50000–51000 | UDP | TURN relay ports |

## Tests

`tools/volna-driver.mjs` drives a headless Chrome through 27 scenarios: join, rejoin,
wrong password, invites, chat, sub-rooms, screen sharing, noise suppression, privacy,
call termination, plus a full-screen screenshot mode. The same driver is used for regression
checks after every change.

## License

MIT for the application. LiveKit is Apache-2.0. The interface background is an original
artwork generated for this project, not a Valve asset.
