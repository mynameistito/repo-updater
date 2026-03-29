---
"repo-updater": minor
---

Add Deno runtime compatibility for global install. Merge `jsr.json` into `deno.json` with `npm:` import maps, add `./cli` export for the CLI entrypoint, and update shebang for cross-runtime support. A lefthook pre-commit hook auto-syncs `package.json` dependencies into `deno.json` imports.
