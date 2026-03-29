---
"repo-updater": minor
---

Add tsdown build pipeline with compiled JS output and `.d.ts` type declarations. Replace raw TS publishing with built `dist/` artifacts for npm consumers while Deno continues to use raw `src/` files. Add consistent `exports` and `bin` fields to both `package.json` and `deno.json`.
