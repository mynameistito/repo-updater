---
"repo-updater": minor
---

Add monorepo/workspace support and changeset control flags

- Auto-detect workspace configuration (pnpm-workspace.yaml, package.json workspaces field) and update all workspace packages using the correct package manager commands (pnpm update -r, npm update --workspaces, etc.)
- Add --no-workspaces flag to opt out of workspace detection and update root only
- Add --no-changeset flag to opt out of automatic changeset creation
- Write multi-package changesets for monorepos listing all changed workspace packages
