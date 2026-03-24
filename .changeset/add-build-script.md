---
"repo-updater": patch
---

Add build and pack scripts for local build verification and CI

- Add `build` script using `bun build` to compile `src/cli.ts` to `dist`
- Add `build:pack` script for creating distributable tarballs
- Add `prepublishOnly` gate that runs build, typecheck, tests, and pack dry-run before publish
- Add Build Verification job to CI workflow (with explicit bun-version)
- Ignore `*.tgz` files in `.gitignore`
