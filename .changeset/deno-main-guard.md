---
"repo-updater": minor
---

Add `bin` field to `deno.json` and `exports` field to `package.json` so both registries have consistent entry points. `deno install -g -n repo-updater jsr:@mynameistito/repo-updater/cli` now creates a proper executable shim.
