---
"repo-updater": patch
---

Fix Windows UAC prompt and console flash on launch.

The bin name `repo-updater.exe` matches Windows Installer Detection (filename contains "update"), which auto-elevates unsigned `.exe` files without a manifest. A postinstall script now writes an `asInvoker` sidecar manifest next to the installed shim and bumps its mtime to invalidate Windows' cached elevation decision. A runtime self-heal covers `bun add -g`, which skips lifecycle scripts by default. The earlier Bun→Node re-exec in `cli.ts` is removed — it was the source of the terminal flash (spawned `node` via a `.cmd` shim under nvm/fnm/volta).
