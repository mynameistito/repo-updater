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
import { ensureWindowsManifest } from "../dist/windows-manifest.mjs";

const patched = ensureWindowsManifest();
if (patched > 0) {
  console.log(
    `repo-updater: wrote external manifest for ${patched} shim(s) (Windows UAC suppression)`
  );
}
