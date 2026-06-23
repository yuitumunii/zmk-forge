// electron-builder afterPack hook: ad-hoc re-sign the packed .app so its
// Info.plist is BOUND to the signature. macOS 26 (Sequoia+) TCC rejects a
// Bluetooth usage description from an unbound Info.plist and SIGABRTs the
// process the moment Bluetooth is touched. electron-builder's own signing
// (with identity:null) is skipped, and the stock Electron signature leaves
// Info.plist unbound — so we seal it here. `--force --deep --sign -` re-signs
// the whole bundle ad-hoc and binds the plist + seals Resources.
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = join(context.appOutDir, `${appName}.app`);

  // --- Runtime hardening: flip Electron fuses ------------------------------
  // Lock down ways an attacker could turn this signed app into an arbitrary
  // Node.js runtime. Must run BEFORE the codesign below: flipping fuses edits
  // the main binary, which invalidates any signature — so we let fuses re-apply
  // an ad-hoc signature to the binary, then the deep codesign re-seals the whole
  // bundle (and binds Info.plist) afterwards.
  const electronBinary = join(appPath, "Contents", "MacOS", appName);
  console.log(`[afterPack] flipping Electron fuses: ${electronBinary}`);
  await flipFuses(electronBinary, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
  console.log("[afterPack] fuses flipped ✓");

  console.log(`[afterPack] ad-hoc signing (bind Info.plist for BLE/TCC): ${appPath}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
  // Sanity: fail the build if the plist still isn't bound.
  const out = execFileSync("codesign", ["-dv", appPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (/Info\.plist=not bound/.test(out)) {
    throw new Error("[afterPack] Info.plist still not bound after re-sign");
  }
  console.log("[afterPack] signature bound ✓");
};
