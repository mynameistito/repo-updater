#!/usr/bin/env node
// Writes an external `<bin>.exe.manifest` next to the installed Windows shim
// declaring `requestedExecutionLevel=asInvoker`. Without this, Windows
// Installer Detection auto-elevates unsigned `.exe` files whose names contain
// "update" / "install" / "setup" / "patch" — producing a UAC prompt and a
// console flash on every launch.
//
// Also bumps the .exe mtime to invalidate Windows' per-file elevation cache,
// so the manifest is picked up on the next launch instead of after the next
// reinstall.
//
// Runs as a `postinstall` lifecycle script. Silent no-op on non-Windows and
// when no shim is found.
//
// Note: Bun skips lifecycle scripts by default (security). Users installing
// via `bun add -g` need `bun pm trust repo-updater` to run this, OR can
// invoke this script manually:
//   node <global-bin>/../lib/node_modules/repo-updater/scripts/install-windows-manifest.mjs

import { existsSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

if (process.platform !== "win32") {
  process.exit(0);
}

const BIN_NAME = "repo-updater";

const MANIFEST = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
`;

function* candidateBinDirs() {
  // npm / pnpm / yarn — set during lifecycle script execution
  if (process.env.npm_config_prefix) {
    yield process.env.npm_config_prefix;
  }
  // Bun global bin
  if (process.env.BUN_INSTALL) {
    yield join(process.env.BUN_INSTALL, "bin");
  }
  if (process.env.USERPROFILE) {
    yield join(process.env.USERPROFILE, ".bun", "bin");
  }
  // PATH fallback — covers volta, fnm, custom installs
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir) {
      yield dir;
    }
  }
}

let wroteAny = false;
const seen = new Set();
for (const dir of candidateBinDirs()) {
  if (seen.has(dir)) {
    continue;
  }
  seen.add(dir);

  const exe = join(dir, `${BIN_NAME}.exe`);
  if (!existsSync(exe)) {
    continue;
  }

  try {
    writeFileSync(`${exe}.manifest`, MANIFEST);
    // Bump mtime so Windows treats this as a new file and re-runs Installer
    // Detection with the manifest present.
    const st = statSync(exe);
    utimesSync(exe, st.atime, new Date());
    wroteAny = true;
  } catch {
    // Permission denied or similar — skip silently.
  }
}

if (!wroteAny && process.env.npm_config_loglevel === "verbose") {
  process.stderr.write(`${BIN_NAME}: no .exe shim found; skipped manifest.\n`);
}
