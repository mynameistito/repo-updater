#!/usr/bin/env node
/**
 * @module install-windows-manifest
 *
 * postinstall thin wrapper. Delegates to the bundled `windows-manifest`
 * module so the manifest payload and shim-discovery logic stay in one
 * place (src/windows-manifest.ts). Safe no-op on non-Windows.
 *
 * Note: bun's `bun add -g` skips lifecycle scripts entirely, so this only
 * runs zero-touch for npm/pnpm/yarn global installs. Bun globals self-heal
 * on first invocation via cli.ts (one UAC prompt, then silent).
 */
// Dynamic import: `dist/` is absent during local dev / from-source installs,
// and postinstall must never fail. ERR_MODULE_NOT_FOUND => silent no-op.
let patched = 0;
try {
  const mod = await import("../dist/windows-manifest.mjs");
  patched = mod.ensureWindowsManifest();
} catch (err) {
  if (
    !(
      err &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "ERR_MODULE_NOT_FOUND"
    )
  ) {
    throw err;
  }
}
if (patched > 0) {
  console.log(
    `repo-updater: wrote external manifest for ${patched} shim(s) (Windows UAC suppression)`
  );
}
