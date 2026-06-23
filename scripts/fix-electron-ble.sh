#!/usr/bin/env bash
# Re-sign the dev Electron.app so macOS TCC accepts its Bluetooth permission.
#
# Why: The Electron npm package ships with adhoc/linker-signed binaries where
# Info.plist is NOT bound to the code signature. macOS 26 (Sequoia+) TCC
# rejects NSBluetoothAlwaysUsageDescription from an unbound Info.plist and
# aborts the process (SIGABRT) the moment Bluetooth is accessed.
# Fix: codesign --force --deep --sign - re-signs the whole app bundle with
# the ad-hoc identity but properly seals Resources and binds Info.plist.
# npm install resets the Electron binary; this script is idempotent (no-op
# when already bound).
set -euo pipefail

APP="node_modules/electron/dist/Electron.app"
if [ ! -d "$APP" ]; then
  echo "ERROR: Electron.app not found at $APP" >&2
  exit 1
fi

STATUS=$(codesign -dv "$APP" 2>&1)
if echo "$STATUS" | grep -q "Info.plist=not bound"; then
  echo "Electron.app: Info.plist not bound — re-signing for Bluetooth/TCC..."
  codesign --force --deep --sign - "$APP"
  echo "Done. Verification:"
  codesign -dv "$APP" 2>&1 | grep -E "Info\.plist|Sealed|Signature"
else
  echo "Electron.app: Info.plist already bound — no re-sign needed."
fi
