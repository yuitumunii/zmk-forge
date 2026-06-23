# Fork Notice

This project (**ZMK Forge**) is a fork of
[zmkfirmware/zmk-studio](https://github.com/zmkfirmware/zmk-studio),
licensed under the **Apache License, Version 2.0**.

- Upstream pinned at commit: `f949d5e5f5f2d32f35b9343a439294487a62653e` (2025-11-26, v0.3.1)
- Upstream remote is configured as `upstream` (`git remote -v`).
- Original `LICENSE` (Apache-2.0) and `NOTICE` are retained unmodified.

---

## Changes made in this fork

Apache-2.0 §4 requires stating modifications. The following changes have been
implemented on top of the upstream codebase.

### 1. Native BLE Connection (Electron)

Added an Electron host with native Bluetooth Low Energy support via
`@stoprocent/noble`. The upstream app targets Tauri; this fork runs as an Electron
app on macOS. BLE connection to the keyboard works without a USB cable.

### 2. GitHub Sync

Reads the live keymap from the connected keyboard and writes it back into a local
`zmk-config` clone as a `.keymap` devicetree source file, then commits and pushes
(manual button). This implements upstream feature request
[zmk-studio#124](https://github.com/zmkfirmware/zmk-studio/issues/124).

> **Warning:** the sync operation runs `git reset --hard` on the clone before writing
> files. Point `clonePath` at a dedicated clone, not your primary working copy.

### 3. Live Tuning via Custom RPC

Four live-adjustment panels communicate with the keyboard in real time over BLE
using `pyuron_*` custom ZMK RPC services. Firmware must implement these RPCs;
standard ZMK keyboards will not show the panels.

#### 3a. Gesture Sensitivity
Adjusts the trackball gesture-detection thresholds (direction sensitivity) without
reflashing. Values are written to the keyboard and take effect immediately.

#### 3b. AML (Automatic Mouse Layer)
Enables or disables the Automatic Mouse Layer and adjusts the speed multiplier
live. No reflash required.

#### 3c. Trackball CPI
Sets the counts-per-inch (resolution) of the trackball sensor independently for
the left and right keyboard halves.

#### 3d. Timing Parameters for Dual-Role Keys
Adjusts `tapping-term`, `quick-tap-ms`, and `flavor` for `&mt` (mod-tap) and
`&lt` (layer-tap) behaviors in real time.

### 4. UI Improvements

- Reskinned layout toward a cleaner studio-style appearance.
- Gesture, AML, CPI, and Timing panels added to the sidebar navigation.
- Panels are hidden automatically when the connected firmware does not advertise
  the required custom RPC service.

---

See `DEVELOPMENT.md` for architecture details and local build instructions.
