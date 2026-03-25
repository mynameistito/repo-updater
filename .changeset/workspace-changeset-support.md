---
"repo-updater": minor
---

Add monorepo/workspace support and changeset control flags

- Auto-detect workspace configuration (pnpm-workspace.yaml, package.json workspaces field) and update all workspace packages using the correct package manager commands (pnpm update -r, npm update --workspaces, etc.)
- Add --no-workspaces flag to opt out of workspace detection and update root only
- Add --no-changeset flag to opt out of automatic changeset creation
- Write multi-package changesets for monorepos listing all changed workspace packages
- Fix negation glob exclusion (e.g. `!packages/internal`) — patterns are now resolved and applied as post-resolution exclusions instead of being silently skipped
- Fix `**` workspace globs to recursively match nested directories instead of only matching one level deep
- Fix overlapping workspace globs producing duplicate package entries
- Fix duplicate package names in workspace snapshots silently overwriting earlier entries
- Fix Yarn workspace update command to use npm-check-updates with `--workspaces` instead of the non-recursive `yarn upgrade`
- Fix TOCTOU race in workspace glob resolution between existence check and stat
- Replace ad-hoc pnpm-workspace.yaml line parser with the `yaml` library to support flow-style sequences (e.g. `packages: ["a", "b"]`)
- Normalize arrow character in workspace changeset output to match single-package changesets
