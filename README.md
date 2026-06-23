# ZMK Forge

A ZMK keyboard configuration tool with live tuning support — a fork of the official
[zmkfirmware/zmk-studio](https://github.com/zmkfirmware/zmk-studio).

> **App name is provisional.** "ZMK Forge" is a working title pending final decision.

---

## Overview

ZMK Forge extends the upstream ZMK Studio UI with two additional capabilities:

1. **GitHub Sync** — reads the live keymap from a connected keyboard and writes it back
   into a local `zmk-config` clone as a `.keymap` devicetree source file, then commits
   and pushes (manual button). Implements the upstream feature request
   [zmk-studio#124](https://github.com/zmkfirmware/zmk-studio/issues/124).

2. **Live Tuning** — adjusts keyboard behaviour in real time over BLE without
   reflashing firmware:
   - Gesture sensitivity (trackball direction thresholds)
   - AML (Automatic Mouse Layer) enable/disable and speed multiplier
   - Trackball CPI (left and right halves independently)
   - Timing parameters for dual-role keys (`&mt` / `&lt`): tapping-term, quick-tap,
     flavor

---

## Important: Firmware Compatibility

| Feature | Requirement |
|---------|-------------|
| Keymap editing (layers, keycodes) | Any ZMK Studio-compatible keyboard |
| GitHub Sync | Any ZMK Studio-compatible keyboard |
| Live Tuning (Gesture / AML / CPI / Timing) | **Pyuron-compatible firmware with `pyuron_*` custom RPC only** |

Connecting a standard ZMK keyboard works normally — keymap editing and GitHub Sync
are fully usable. The Live Tuning tabs are still shown, but each displays an
"unsupported" message when the connected firmware does not advertise the required
custom RPC service. Connecting a standard ZMK keyboard never causes errors.

➡️ **Want Live Tuning on your own keyboard?** See
[docs/FIRMWARE-COMPATIBILITY.md](./docs/FIRMWARE-COMPATIBILITY.md) for how to build a
compatible firmware (use the reference ZMK fork, or port the `pyuron_*` RPC subsystems
into your own).

---

## Platform

- **macOS** (Apple Silicon) via Electron
- Native BLE connection to the keyboard (no USB cable required for most operations)

---

## Installation

Download the latest `.dmg` from the
[Releases](../../releases) page, open it, and drag **ZMK Forge.app** to your
Applications folder.

Because the app is not notarized, macOS Gatekeeper will block the first launch.
Right-click (or Control-click) the app and choose **Open** to bypass the warning.

---

## Setup — Adding Your Keyboard(s)

ZMK Forge manages one or more **device profiles**. Each profile pairs a keyboard with
the local `zmk-config` clone it syncs to.

1. On first run, click **Add device** and fill in:
   - **Name** — any label (e.g. your keyboard's name)
   - **Clone path** — a *dedicated* local clone of your `zmk-config` (see the warning
     below); use the picker button
   - **Keymap path** — the `.keymap` file inside that clone (e.g. `config/my.keymap`)
   - **Remote / Branch** — usually `origin` / `main`
2. Connect the keyboard; the first successful connection binds it to the active profile.
3. Switch between keyboards anytime from the **device dropdown** in the header. Each
   profile remembers its own clone, keymap path, and paired device.

The GitHub token (Settings) is shared across all profiles — one account pushes to all
your config repos.

---

## Build from source / 自分でビルドする

Anyone can build ZMK Forge from source — you do not need to download the release.

### Prerequisites

- **macOS (Apple Silicon)** — the only build currently produced/tested
- **Node.js 20+**
- **Xcode Command Line Tools** — `xcode-select --install`
  (the macOS build runs `codesign` to bind BLE/TCC entitlements)

### Build the app

```bash
git clone --depth=1 https://github.com/yuitumunii/zmk-forge.git
cd zmk-forge
npm install
npm run electron:build      # output: release/ZMK Forge-<version>-arm64.dmg
open release
```

Notes:
- `src/data/release-data.json` is generated during the build. If GitHub is
  unreachable (offline / rate-limited), a placeholder is written and the build
  still succeeds — no `GITHUB_TOKEN` is required.
- Native BLE support uses `@stoprocent/noble`, which ships prebuilt binaries for
  macOS; `npm install` only compiles if a prebuild is unavailable.

### Run in development mode

```bash
npm install
npm run electron:dev
```

This builds the Electron main/preload scripts, then launches Vite + Electron with hot
reload for the renderer.

---

## GitHub Sync — Destructive Behaviour Warning

The Sync feature performs a `git reset --hard` on the target repository clone before
writing new keymap files.

**Any uncommitted changes in `clonePath` will be permanently lost.**

Always point `clonePath` at a dedicated clone created solely for ZMK Forge. Do not use
your primary working copy of `zmk-config`.

---

## Credits

This project is a fork of
[zmkfirmware/zmk-studio](https://github.com/zmkfirmware/zmk-studio) by the ZMK
contributors, licensed under the **Apache License, Version 2.0**.

- [LICENSE](./LICENSE) — full license text
- [NOTICE](./NOTICE) — upstream attribution notices
- [FORK_NOTICE.md](./FORK_NOTICE.md) — summary of changes made in this fork
- [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) — bundled third-party works
  (ZMK Studio, the Inter font under SIL OFL 1.1, and Font Awesome Free brand icons
  under CC BY 4.0)
