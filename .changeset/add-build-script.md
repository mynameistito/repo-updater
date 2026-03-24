---
"repo-updater": patch
---

Add build scripts for local build verification and CI

- Add `build` script using `bun build` to compile `src/cli.ts` to `dist`
- Add lightweight `prepublishOnly` gate: build + `npm pack --dry-run`
- Add Build Verification job to CI workflow (with explicit bun-version)
- Gate Release workflow on CI success via `workflow_run`
- Ignore `*.tgz` files in `.gitignore`
