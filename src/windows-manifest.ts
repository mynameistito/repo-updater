/**
 * @module windows-manifest
 *
 * Runtime self-heal for the Windows UAC prompt triggered by the bun-generated
 * `repo-updater.exe` shim. The shim's filename matches Windows' Installer
 * Detection heuristic (substring "update") and gets auto-elevated on launch
 * because it has no embedded application manifest.
 *
 * Strategy: drop an external `repo-updater.exe.manifest` next to the shim
 * declaring `asInvoker`, then bump the shim's mtime so Windows invalidates
 * its cached elevation decision and re-reads the manifest. The first launch
 * still triggers UAC (we can't act before the OS evaluates the binary), but
 * every subsequent launch is silent.
 *
 * Cheap on non-Windows: the platform check is the very first statement.
 */
import { existsSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MANIFEST = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity type="win32" name="repo-updater" version="1.0.0.0" processorArchitecture="*"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{e2011457-1546-43c5-a5fe-008deee3d3f0}"/>
      <supportedOS Id="{35138b9a-5d96-4fbd-8e2d-a2440225f93a}"/>
      <supportedOS Id="{4a2f28e3-53b9-4441-ba9c-d69d4a4a6e38}"/>
      <supportedOS Id="{1f676c76-80e1-4239-95bb-83d0f6d0da78}"/>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
    </application>
  </compatibility>
</assembly>
`;

function getCandidateShimPaths(): string[] {
  const home = homedir();
  return [
    process.env.npm_config_prefix
      ? join(process.env.npm_config_prefix, "repo-updater.exe")
      : null,
    process.env.PNPM_HOME
      ? join(process.env.PNPM_HOME, "repo-updater.exe")
      : null,
    process.env.BUN_INSTALL
      ? join(process.env.BUN_INSTALL, "bin", "repo-updater.exe")
      : null,
    join(home, ".cache", ".bun", "bin", "repo-updater.exe"),
    join(home, ".bun", "bin", "repo-updater.exe"),
    join(home, "AppData", "Roaming", "npm", "repo-updater.exe"),
    join(home, "AppData", "Local", "pnpm", "repo-updater.exe"),
    join(home, "AppData", "Local", "Yarn", "bin", "repo-updater.exe"),
  ].filter((p): p is string => typeof p === "string");
}

/**
 * Best-effort: ensure the Windows shim has an external asInvoker manifest.
 * Always swallows errors — never blocks CLI startup.
 *
 * @returns Number of shims patched this call (0 if already done or none found).
 */
export function ensureWindowsManifest(): number {
  if (process.platform !== "win32") {
    return 0;
  }
  let patched = 0;
  for (const exe of getCandidateShimPaths()) {
    try {
      if (!existsSync(exe)) {
        continue;
      }
      const manifestPath = `${exe}.manifest`;
      if (existsSync(manifestPath)) {
        continue;
      }
      writeFileSync(manifestPath, MANIFEST, "utf8");
      const now = new Date();
      utimesSync(exe, now, now);
      patched += 1;
    } catch {
      // Non-fatal. Skip and try next candidate.
    }
  }
  return patched;
}
