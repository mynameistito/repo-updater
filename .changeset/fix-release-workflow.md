---
"repo-updater": patch
---

Fix release workflow: use npm pack and gate on CI success

- Replace `bun pack --dry-run` with `npm pack --dry-run` in prepublishOnly (fixes `Script not found "pack"` error during npm publish)
- Slim prepublishOnly to build + pack only (CI already validates typecheck + tests)
- Gate Release workflow on CI success via `workflow_run`
- Remove redundant `build:pack` script
