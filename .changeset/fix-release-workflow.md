---
"repo-updater": patch
---

Fix release workflow and harden CI

- Fix npm OIDC Trusted Publishing: remove `registry-url` injection, upgrade npm for OIDC support
- Pin release checkout to `workflow_run.head_sha` for deterministic releases
- Use commit SHA in concurrency keys to prevent injection risk
- Add concurrency block to CI to deduplicate runs on rapid pushes
- Gate release workflow on CI success via `workflow_run`
- Remove redundant `npm pack --dry-run` from `prepublishOnly`
- Delete redundant `.npmignore` (superseded by `files` allowlist)
