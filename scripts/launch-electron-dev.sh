#!/usr/bin/env bash
# Launch Electron via macOS `open -a` so Electron is its own "responsible
# process" in TCC. When launched as a subprocess of another app (e.g.
# a terminal inside Claude), TCC attributes Bluetooth access to the PARENT
# app, which lacks NSBluetoothAlwaysUsageDescription and crashes.
# Using `open` makes LaunchServices start Electron independently.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON_APP="$REPO/node_modules/electron/dist/Electron.app"
MAIN_CJS="$REPO/dist-electron/main.cjs"

if [ ! -d "$ELECTRON_APP" ]; then
  echo "ERROR: Electron.app not found at $ELECTRON_APP" >&2
  exit 1
fi
if [ ! -f "$MAIN_CJS" ]; then
  echo "ERROR: dist-electron/main.cjs not found — run build:electron first" >&2
  exit 1
fi

echo "Launching Electron via open -n (TCC-safe)..."
open -n "$ELECTRON_APP" --args "$MAIN_CJS"
echo "Done. Electron launched as independent app process."
