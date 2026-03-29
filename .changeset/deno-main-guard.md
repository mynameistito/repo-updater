---
"repo-updater": patch
---

Change deno.json default export (`"."`) to point to `cli.ts` so `deno install jsr:@mynameistito/repo-updater` runs the CLI out of the box, matching the npm/bun `bin` pattern. Library access via `jsr:@mynameistito/repo-updater/index`.
