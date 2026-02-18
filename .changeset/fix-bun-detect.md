---
"repo-updater": patch
---

Fix package manager detection to prioritize bun.lock over package-lock.json.

When a project has both bun.lock and package-lock.json, the detection now correctly identifies it as a bun project instead of npm.
