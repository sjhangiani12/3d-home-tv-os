# 3D Home TV OS

[![CI](https://github.com/Rod292/3d-home-tv-os/actions/workflows/ci.yml/badge.svg)](https://github.com/Rod292/3d-home-tv-os/actions/workflows/ci.yml)

**Scan your home, turn it into a live 3D model, and make it your TV's home screen** — no ads, no
"recommended for you" — with your lights and devices wired in. Flip a lamp from the remote: it turns
on in real life and in the 3D. Select a lamp and the 3D shows you which one it is. Same home on your
phone and in your Mac's menu bar.

This repo is built to be **vibe coded**: point your AI coding agent at it and let it walk you
through. It contains:

- a **playbook for AI agents** ([`AGENTS.md`](AGENTS.md) → [`playbook/`](playbook/)): an interview to
  fit *your* hardware, phases with explicit "done" checks, and the pitfalls that cost us hours
  ([`playbook/gotchas.md`](playbook/gotchas.md));
- a **working reference implementation** you adapt rather than rewrite.

## Quick start

```sh
git clone https://github.com/Rod292/3d-home-tv-os && cd 3d-home-tv-os
pnpm install                                   # Node >= 24, pnpm 10
pnpm --filter @appart3d/web build
HOME_BRIDGE_MOCK=1 pnpm --filter @appart3d/home-bridge start
open "http://localhost:8787/?view=3d&orbit=full"   # demo apartment with simulated lights
```

Then open your agent in the repo and say something like:

> Read AGENTS.md and help me build this for my home. My TV is a … , my lights are … .

Claude Code, Codex, Cursor, Copilot, Gemini CLI, Jules, Aider and Windsurf all pick up the
instructions (`AGENTS.md`, plus thin `CLAUDE.md` / `GEMINI.md` / `.cursor/rules` /
`.github/copilot-instructions.md` pointers).

## The path

| Phase | You get | Reference code |
|---|---|---|
| [0 · Start](playbook/00-start.md) | A plan for your TV, lights and machines | — |
| [1 · Scan](playbook/01-scan.md) | Your rooms, walls and furniture (iPhone LiDAR, or drawn) | `apps/ios`, `packages/roomplan-import` |
| [2 · 3D model](playbook/02-model.md) | A low-poly "dollhouse" of your home, editable in the browser | `apps/web`, `packages/catalog`, `packages/scene` |
| [3 · Bridge](playbook/03-bridge.md) | Hue, Home Assistant (Tuya, Zigbee, TVs…), HomePod, Sonos → one live API | `apps/home-bridge`, `packages/home` |
| [4 · TV](playbook/04-tv-launcher.md) | The new home screen: 3D + lights panel + dock + screensaver | `apps/tv-launcher` |
| [5 · Phone & desktop](playbook/05-phone-and-desktop.md) | iPhone app + widgets, macOS menu-bar widget | `apps/ios-home`, `apps/macos` |
| [6 · Always on](playbook/06-always-on.md) | Runs 24/7 (Raspberry Pi or an awake Mac) | — |

[Verification](playbook/verification.md) · [Recovery (undo on the TV)](playbook/recovery.md) ·
[Privacy](playbook/privacy.md)

## The block

The TV's home screen can also be your street: a live isometric pixel-art diorama (`apps/web/block.html`)
with traffic, people, the nearest subway station (MTA feed via the bridge's `/mta.json`), two Citi Bike
docks (`/citibike.json`), the weather (Open-Meteo) and your lamps lighting your windows. Lights flies the
camera to your door and into your 3D home. On the remote, ↑ from the dock moves between the signs; OK zooms
into the station or a dock.

Sonos speakers show up on their own (the bridge finds them on the Wi-Fi, no account): a now-playing sign
beside the house with the cover as pixel art, notes rising off the roof while it plays, and a music panel
(OK on the sign) with play/pause, skip and a volume bar for each room.

The code draws a generic block. Your own names stay out of git, in `apps/web/public/shared/block-home.json`
beside your apartment model (all optional):

```json
{
  "title": "My Block", "place": "MY STREET", "address": "12 Main St", "homeLabel": "12 · Home",
  "seed": 1234, "location": { "latitude": 40.75, "longitude": -73.98 },
  "avenues": ["…5 names, west to east…"], "streets": ["…7 names, north to south…"],
  "station": { "name": "Grand Central", "line": "Lexington Av line", "stop": "631" },
  "docks": [{ "name": "West dock name", "side": "← WEST" }, { "name": "East dock name", "side": "EAST →" }],
  "rooms": [{ "name": "Living room", "lamps": [{ "id": 4, "name": "Hue light 4's name" }] }]
}
```

`stop` is the MTA GTFS parent stop id; `lamps[].id` is the Hue light id. Set `citibikeStations` in
`~/.config/appart3d/home.json` to pick the docks (the two nearest to `location` by default).

## What works with what

- **TV:** Google TV and Android TV (e.g. Philips, Sony, TCL, Hisense, Chromecast with Google TV), and
  Fire TV (Fire OS 8, the same accessibility-service approach).
  Apple TV, Samsung and LG home screens can't be replaced — add a Google TV dongle.
- **Lights:** Philips Hue directly; anything Home Assistant supports.
- **Speakers:** Sonos directly (local UPnP: now playing, transport, per-room volume); HomePod via pyatv.
- **Scan:** iPhone/iPad Pro with LiDAR for the scanner app; otherwise draw the plan.
- **Always-on host:** macOS (launchd) or Linux (systemd, Raspberry Pi).

## Safety

Everything done on the TV is reversible ([recovery](playbook/recovery.md)), and agents are told to
ask before each TV step and before switching real devices. The stock Google TV home stays installed
as a fallback: if the 3D crashes, the dock and lights keep working; if the launcher crash-loops, the
Home key goes back to Google TV on its own. Your scan is the inside of your home: the
`.gitignore` keeps scans, your scene, tokens and device config out of git
([privacy](playbook/privacy.md)).

## Known limitations

- Tested end to end on **one** setup: a Philips Google TV, Philips Hue, Home Assistant (Tuya fan,
  Philips TV), a HomePod mini, a Mac as host. Other TV brands and hosts should work but are untested.
- The TV launcher follows the TV's language (English, French). The web editor and the iPhone/Mac
  apps are still in **French** — ask your agent to translate them.
- Furniture is procedural: unusual pieces need a small builder (your agent can write it from a
  photo — see phase 2). The scanner needs an iPhone/iPad Pro with LiDAR and Xcode.
- The Raspberry Pi path is documented, not yet battle-tested.

## Status

A personal project shared as-is: it runs daily on one Philips Google TV with Hue + Home Assistant.
Expect to adapt things to your home — that's what the playbook is for. Issues and PRs welcome.

MIT licensed.
