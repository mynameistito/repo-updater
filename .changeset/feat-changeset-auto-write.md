---
"repo-updater": minor
---

Auto-write a Changesets file on dep-update PRs for repos that use Changesets.

- Detects Changesets via `.changeset/config.json` or `@changesets/cli` in `devDependencies`
- Snapshots `dependencies` before and after the update, then writes a `patch` changeset if anything changed
- Skips writing if the target changeset file already exists (idempotent across retries)
- Automatically cleans up the changeset file on failure during branch rollback
- Dry-run mode previews the changeset step without writing anything
