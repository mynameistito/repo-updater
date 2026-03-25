---
"repo-updater": minor
---

Add monorepo/workspace support and changeset control flags

- Auto-detect workspace configuration from pnpm-workspace.yaml or package.json workspaces field
- Update all workspace packages using correct package manager commands (pnpm update -r, npm update --workspaces, ncu --workspaces for Yarn)
- Add --no-workspaces flag to skip workspace detection and update root only
- Add --no-changeset flag to skip automatic changeset creation
- Generate multi-package changesets listing all changed workspace packages
- Fix `**` glob patterns to recursively match nested directories
- Fix negation patterns (e.g., `!packages/internal`) to work correctly as post-resolution exclusions
- Fix duplicate workspace entries from overlapping or repeated globs
- Warn instead of silently overwriting when duplicate package names are detected
- Parse pnpm-workspace.yaml with `yaml` library to support all YAML formats (flow-style, multiline, etc.)
