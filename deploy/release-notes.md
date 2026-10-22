# Volna 1.7.1 — show password buttons

Self-hosted voice rooms with screen sharing. This release is about the look and feel:
a new visual language, a Discord-style channel list, and a chat that lives inside the room.

- **Invite links also work as ?i=** in the query string, so messengers that drop the part after # no longer break the auto-join.

## What's new in 1.7.1

- **Show password.** Every password field (sign-in, repeat password, room password) has an eye
  button: one click reveals the text, another hides it, the icon switches between open and
  crossed out. Works on the sign-in screen and in the join form.

## What's new in 1.7.0

- **Sign-in screen with login and password.** A profile is created on the device (login,
  password hashed with PBKDF2-SHA-256, 120k iterations), a session lasts 30 days and can be
  closed from the left column. Note: accounts are local to the browser, not server-side, because
  the room itself is protected by the shared room password.
- **No automatic entry.** Invite links and the last room only prefill the form; joining requires
  an explicit “Войти в комнату”. The auto-join countdown is gone.
- **Friends panel** under the participants: add by name, online dot reflects the current room,
  one click to visit a friend's room, ✕ to remove.

## What's new in 1.6.2

- **Menu adapts to the mode.** With `remote.json` present the item that used to stop a local
  server now reads “Закрыть приложение” and its dialog explains that the room keeps running on
  the domain.
- Verified again: the window opens `https://volna.is-cool.dev`, joins the room, renders one tile,
  shows 66 ms ping and spawns no local Node or LiveKit processes.

## What's new in 1.6.1

- **Desktop app can run against the domain.** If `remote.json` exists (in `%APPDATA%\Volna\`
  or next to the app), Electron loads that URL with the invite code, skips starting a local
  server entirely and joins the room on the remote host.
- Tested: the window opens `https://volna.is-cool.dev`, the room is joined, the participant tile
  is rendered, ping shows 63 ms, and no local Node or LiveKit processes are spawned.
- The file is personal (it contains the room code) and is not part of the repository.

## What's new in 1.6.0

- **Audio stays level during screen sharing.** Screen-share bitrate was cut (1440p 12 → 6 Mbit/s,
  1080p 6 → 4.5, layers 1.2/2.8/4.5), DTX is off, RED is on and voice is published at 64 kbit/s,
  so a heavy stream no longer squeezes the voice channel.
- **Room switch feels instant.** The “switching room” overlay appears only if the transition takes
  longer than 250 ms, so a quick switch shows nothing at all.
- **Stream in its own window.** A “В окне” button on the stage bar pops the shared screen into
  Picture-in-Picture; where PiP is unavailable a separate browser window is opened with the same
  stream. Works both for the broadcaster and for viewers.

## What's new in 1.5.3

- **Assets are versioned** (`?v=…` on styles and scripts). Static files are served with a
  one-hour cache, so after an update the browser used to keep the old client for up to an hour;
  now a new build is fetched immediately.
- **Participant stays visible after creating a sub-room** — the switch runs the normal join flow
  under a short overlay, so tiles and the participant list are rendered again.

## What's new in 1.5.2

- **Fixed: the participant disappeared after creating a sub-room.** The room switch used to
  hide the sign-in screen to avoid a flash; that skipped the client's re-render, so tiles and the
  participant list stayed empty while the counter showed 1. The screen now runs its normal flow
  and a short overlay covers the transition instead.
- Verified on the domain: after creating a room there is 1 tile and 1 row in Participants.

## What's new in 1.5.1

- **HTTP → HTTPS redirect.** A small service (`server/redirect.js`, unit `volna-redirect`)
  answers on port 80 and sends every request to `https://volna.is-cool.dev`.
- **Invites use the domain.** The address list that the “Invite” button reads puts the domain
  first, so shared links point at the domain rather than an IP.
- **Certificate renewal hook** restarts the application after `certbot renew`, so a renewed
  certificate is picked up automatically.

## What's new in 1.5.0

- **Custom domain.** The server now answers on `https://volna.is-cool.dev` with a Let's Encrypt
  certificate (auto-renewed), port 443, no browser warnings.
- **New room backdrop.** A panoramic battlefield in the spirit of Dota 2: a stone bridge over a
  glowing river, a Radiant tower with green runes, a Dire tower in fire, armies in the fog.
- **Attach button moved** into the message row, right next to Send.

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
75fdd56bca4ee65502916cccc9e47bfad7fb951e26f0041ab5c1797278e6a926  volna-voice-app.zip
31b7e18709f52c717c99619f31d8104bab8cba3ce4b78a9563cd9f94f45ca04e  volna-voice-app-linux.tar.gz
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
