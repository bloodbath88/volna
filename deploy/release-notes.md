# Volna 1.4.4 — no phantom “Client initiated disconnect”

Self-hosted voice rooms with screen sharing. This release is about the look and feel:
a new visual language, a Discord-style channel list, and a chat that lives inside the room.

- **Invite links also work as ?i=** in the query string, so messengers that drop the part after # no longer break the auto-join.

## What's new in 1.4.4

- **Phantom join errors removed.** When a room is left or switched, LiveKit reports the
  disconnect of the previous connection; those notifications are now filtered out, so the room
  no longer shows “Не удалось войти: Client initiated disconnect”. Real errors stay visible.
- **Single join attempt.** A second join is ignored while the first one is in flight or while
  you are already in a room, which removes a source of double connections.

## What's new in 1.4.3

- **The main room is labelled «Основной»** everywhere in the interface; its technical name
  stays `main`, so links and invites keep working.
- **Deleting a sub-room leaves no trace.** The stored display name and the saved “current room”
  are cleared together with the room, and the list is redrawn at once.
- **Orphan names are pruned on load**, so a renamed room that no longer exists cannot reappear.

## What's new in 1.4.2

- **Ping in the header.** A live round-trip indicator sits next to the participant counter:
  green under 80 ms, amber under 180 ms, red above. It is measured from the active
  peer connection (`candidate-pair.currentRoundTripTime`) every three seconds and resets
  to “—” when the room is closed.

## What's new in 1.4.1

- **Channel list is always flat.** A room created while standing in a sub-room could produce
  a name like `main--pubg--ererer` and looked nested. Stored names are migrated to their last
  segment, so Main always lists its rooms at one level.
- **No false join errors.** When switching rooms, the disconnect of the previous connection is
  no longer shown as “Не удалось войти: Client initiated disconnect”.

## What's new in 1.2.3

- **Channel list simplified.** The extra header row is gone: the panel starts with the list,
  the current room row reads **Main** and carries the **+** button for creating sub-rooms.
  Rooms are created only when you press it.
- **Typed name applied immediately.** A sub-room you name is shown with that name at once;
  only unnamed rooms get **Subroom 1**, **Subroom 2** …
- **Chat takes the full width** of the stage; its input row now stretches edge to edge.
- **Join sound** replaced with a short two-note chime, closer to Discord; a single lower tone
  plays when somebody leaves.
- **Custom scrollbars** — rounded, accent-tinted, in line with the rest of the interface.
- The **«Чат» button** in the top bar was removed: the chat is always on screen.

## What's new in 1.2.2

- **Room naming is explicit.** The page title reads **Volna**, the current room is shown as
  **Main** or **Subroom 1 / Subroom 2 …** — a parent name never leaks into a child,
  every entry carries its own label.
- **Seamless chat.** The panel lost its border and background card: it fades into the stage
  and stays visible for every participant.
- **Brighter backdrop** on both the room and the sign-in screen; the sign-in card is
  semi-transparent so the artwork shows through.
- **Screen sharing hardened.** If the system refuses to capture desktop audio or the server
  rejects simulcast layers, the app falls back automatically (video-only, then plain publish)
  instead of failing silently.
- **1440p60 viewing.** Screen share publishes 720p / 1080p / 1440p simulcast layers;
  a viewer gets the top layer on full screen (double-click the shared video).

## What's new in 1.2.1

- **Chat moved to the center.** It is now a wide panel at the bottom of the stage,
  always visible and shared by everyone in the room — no toggle, no separate window.
- **Instant switching.** Going from a room to a sub-room no longer flashes the join
  screen: the current view stays until the new connection is ready.
- **Predictable names.** The main room is always `main` and cannot be renamed;
  new rooms get `subroom`, `subroom-2`, `subroom-3` … by default.
- **Cleaner chat header.** Only the attach button remains there; rooms are created
  from the channel list with **+**.
- The main room is labelled **«Главная»** in the interface; its technical name stays main.
- **Brighter background** so the artwork and every interface element stay readable.

## What's new

### Sub-rooms that behave like channels

- Channels are listed top-down, sub-rooms nested under their parent with an indent line.
- Create a sub-room with **+** right in the channel list — an inline field appears,
  Enter creates it, Esc cancels. No dialogs, no page jumps.
- The room name is now short everywhere: `main`, `games`, `kitchen` — no more
  `main--test-subroom` strings in the header or the chat title.
- Enter and leave sub-rooms with a single click; a **←** button returns to the parent room.
- Creating a room no longer rebuilds the page: a dark "switching room" veil covers the
  transition and disappears once you are connected.

### Chat

- The floating chat card is gone. The chat is docked at the bottom of the participants
  column, edge to edge, with a single divider — part of the window, not a popup.
- Text labels replaced with icons: **+** (new room), **paperclip** (file), **⌄** (collapse),
  **↑** (send), **←** (back to the main room).
- Files of any type up to 8 MB: button or drag & drop, transfer progress,
  download link, inline preview for images.
- Each room and sub-room has its own chat history.

### Visual language

- New background artwork in the spirit of dark-fantasy game menus (original artwork,
  not a Valve asset), muted so the interface stays readable.
- Palette moved to near-black with an acid-lime accent (`#8EFF03`) and translucent glass
  panels — inspired by modern crypto/gaming dashboards.
- **Manrope** typeface bundled locally (Cyrillic included), no external CDN.
- Softer borders, 16 px radii, subtle inner highlights and glow on primary actions.

### Sound

- A short tone when you enter a room, when somebody joins and when somebody leaves —
  in every room and sub-room.

### Fixes

- **Wrong room name after creating a sub-room.** The name cleaner collapsed the double
  dash that separates a parent room from its sub-room, so `main--test-1` turned into
  `main-test-1` and the sub-room looked like a renamed main room. Fixed.
- **Dead buttons in the chat header.** Handlers were bound to nodes that move in the DOM;
  now they are delegated, so the buttons work after any re-render.
- **Invite links with trailing spaces or quotes** are parsed correctly; if the join still
  fails, the app reveals the password field with a hint instead of showing a bare error.
- **ICE on VPS behind provider NAT.** The server now discovers its external address
  (`use_external_ip: true`, no `node_ip`), which fixed `could not establish pc connection`.

## Files

| File | Purpose | Size |
|---|---|---|
| `volna-voice-app.zip` | Windows host: unpack and run `start.cmd` | 9.7 MB |
| `volna-voice-app-linux.tar.gz` | Linux VPS: unpack and run `sudo ./install-vps.sh` | 7.7 MB |

SHA-256:

```
30b0408f242c8e857b0fcb7da30ee49cabb442a179dbf87afdf9ecb640249deb  volna-voice-app.zip
c6223073385afb46afbd1301246a235c3adec0902dbe42e1db378870b0a5a54f  volna-voice-app-linux.tar.gz
```

## Quick start (Windows)

1. Unpack the archive, for example to `C:\Volna`.
2. `start.cmd` — the first run downloads Node.js and LiveKit (~60 MB) and creates the config.
3. `firewall.cmd` as administrator — open the ports for other devices.
4. `create-shortcut.cmd` — desktop shortcut. `desktop\install-desktop.cmd` — the desktop app.

## Quick start (Linux VPS)

```bash
mkdir -p volna && tar -xzf volna-voice-app-linux.tar.gz -C volna --strip-components=1
cd volna && chmod +x *.sh && sudo ./install-vps.sh --domain voice.example.com --email me@example.com
```

Ports for internet access: `443/tcp`, `7881/tcp`, `7882/udp`. For strict networks
(symmetric NAT, mobile CGNAT) also `3478/udp`, `3478/tcp` and relay range `50000–51000/udp`.

## Notes

Archives contain no secrets and no machine-specific files: `config.json` (room password),
`certs/`, `livekit/livekit.yaml` and the LiveKit binary are created on first start.

Details: `voice-app/README.md`, `SCENARIOS.md`, `PRIVACY.md`, `PROJECT-HANDOVER.md` (Russian).
License: MIT; LiveKit is Apache-2.0.
