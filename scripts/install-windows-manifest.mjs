#!/usr/bin/env node
/**
 * @module install-windows-manifest
 *
 * postinstall helper. On Windows, drops an external application manifest
 * next to the `repo-updater.exe` shim to opt out of Windows Installer
 * Detection (UAC auto-elevation triggered by the substring "update" in the
 * unsigned shim filename). No-op on non-Windows platforms.
 *
 * Locates shims in known global install prefixes for npm, pnpm, yarn, bun.
 * Failures are non-fatal: postinstall must never block the user's install.
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

if (process.platform !== "win32") {
  process.exit(0);
}

const home = homedir();

// Candidate locations for global bin shims across package managers.
const candidates = [
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
].filter((p) => typeof p === "string");

let written = 0;
for (const exe of candidates) {
  if (!existsSync(exe)) {
    continue;
  }
  const manifestPath = `${exe}.manifest`;
  try {
    writeFileSync(manifestPath, MANIFEST, "utf8");
    // Bump the exe's mtime so Windows invalidates its cached elevation
    // decision and re-reads the external manifest on next launch.
    const now = new Date();
    utimesSync(exe, now, now);
    written += 1;
    console.log(`repo-updater: wrote ${manifestPath} (UAC suppression)`);
  } catch (err) {
    console.warn(
      `repo-updater: could not write ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

if (written === 0) {
  console.log(
    "repo-updater: no .exe shim found to manifest. If you see a UAC prompt on launch, run this script again or install via npm."
  );
}
