---
"repo-updater": patch
---

Self-heal Windows UAC suppression on first CLI invocation.

`bun add -g` skips lifecycle scripts unconditionally, so the v0.7.7 postinstall couldn't drop the external `repo-updater.exe.manifest` for bun-installed users — they kept seeing the UAC prompt at startup.

Fixed by extracting the manifest-writing logic into `src/windows-manifest.ts` and invoking `ensureWindowsManifest()` at the top of `cli.ts`. The shim's first launch under bun still triggers UAC (Windows evaluates the binary before any code runs), but the running process drops the manifest + bumps the shim's mtime to invalidate Windows' cached elevation decision. Every subsequent launch is silent.

The postinstall script now delegates to the same module so npm/pnpm/yarn installs continue to be zero-touch.
