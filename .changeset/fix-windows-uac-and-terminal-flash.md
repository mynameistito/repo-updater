---
"repo-updater": minor
---

Fix Windows UAC prompt and terminal-window flash on startup.

- Drop the `Bun.spawnSync(["node", ...])` re-exec in `cli.ts`. It was added to work around `windowsHide` being ignored in Bun's `node:child_process`, but on Windows the re-exec spawned `node` (often a `.cmd` shim under nvm/fnm/volta) through Bun's spawn, which flashed a console window and added an extra elevation hop.
- Add a `postinstall` script (`scripts/install-windows-manifest.mjs`) that writes an external `repo-updater.exe.manifest` declaring `asInvoker` next to the shim. This suppresses Windows' Installer Detection heuristic, which auto-elevates unsigned `.exe` files whose names contain `install`, `setup`, `update`, or `patch`. Runs automatically for npm/pnpm/yarn global installs; bun users need to either trust the package's lifecycle scripts or run the script manually (see README).
