---
"repo-updater": minor
---

Auto-write a Changesets file on dep-update PRs for repos that use Changesets. Detects via `.changeset/config.json` or `@changesets/cli` in `devDependencies`, and writes a `patch` changeset covering changed `dependencies` before committing.
