---
"repo-updater": minor
---

Add `--minor` / `-m` flag to restrict dependency updates to minor and patch versions. Also updates the default npm command to use `npx --yes npm-check-updates --upgrade` to support major-version upgrades, consistent with `pnpm update --latest`, `yarn upgrade --latest`, and `bun update --latest`.
