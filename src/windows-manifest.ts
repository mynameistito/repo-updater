/**
 * @module windows-manifest
 *
 * Writes a sidecar `<exe>.manifest` next to the running launcher on Windows
 * declaring `requestedExecutionLevel=asInvoker`. This suppresses Windows
 * Installer Detection auto-elevation, which fires for unsigned `.exe` files
 * whose names contain "update" / "install" / "setup" / "patch".
 *
 * Used as a runtime fallback for installs that skip the `postinstall`
 * lifecycle script — notably `bun add -g`, which skips scripts unless the
 * package is trusted.
 *
 * Silent no-op on non-Windows, when the manifest already exists, or when the
 * write fails (read-only install, etc.).
 */

import { existsSync, statSync, utimesSync, writeFileSync } from "node:fs";

const MANIFEST_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
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

const TRAILING_SLASHES = /[\\/]+$/;

/**
 * Writes a sidecar asInvoker manifest next to the parent process launcher
 * (the `.exe` shim that spawned this node process) if one is not already
 * present. Runs once at startup; cheap when the manifest exists.
 */
export function selfHealWindowsManifest(): void {
  if (process.platform !== "win32") {
    return;
  }

  // process.argv[0] is node.exe — not the shim. The shim is the parent.
  // ppid points at it; its image path is what we need.
  const shimPath = resolveShimPath();
  if (!shimPath) {
    return;
  }

  const manifestPath = `${shimPath}.manifest`;
  if (existsSync(manifestPath)) {
    return;
  }

  try {
    writeFileSync(manifestPath, MANIFEST_XML);
    // Bump mtime so Windows invalidates its cached elevation decision and
    // re-evaluates with the manifest on the next launch.
    const st = statSync(shimPath);
    utimesSync(shimPath, st.atime, new Date());
  } catch {
    // Read-only install, permission denied, antivirus lock — give up
    // silently. User can rerun manually via `bun pm trust repo-updater`.
  }
}

function resolveShimPath(): string | null {
  // The bun/npm shim spawns node and passes the resolved script path as
  // argv[1]. The shim itself lives next to that script's eventual install
  // directory, but its actual path isn't exposed via argv.
  //
  // Strategy: walk PATH for `repo-updater.exe`. This is the same heuristic
  // the postinstall script uses, and it works regardless of which package
  // manager produced the shim.
  const BIN_NAME = "repo-updater.exe";
  const dirs = (process.env.PATH ?? "").split(";");
  for (const dir of dirs) {
    if (!dir) {
      continue;
    }
    const candidate = `${dir.replace(TRAILING_SLASHES, "")}\\${BIN_NAME}`;
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
