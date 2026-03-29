---
"repo-updater": patch
---

Add `scripts/sync-jsr-version.ts` to auto-sync package.json version into jsr.json after `changeset version`. Guard against missing version field. Wire the sync script into the `version` npm script.
