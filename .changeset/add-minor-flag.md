---
"repo-updater": minor
---

Add `--minor` / `-m` flag to restrict dependency updates to minor and patch versions. Also fixes `npm update` to omit the invalid `--latest` flag, ensuring npm respects semver constraints.
