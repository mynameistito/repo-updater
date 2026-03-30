# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-30
**Commit:** 3cd126d
**Branch:** main

## OVERVIEW

CLI tool to mass-update dependencies across multiple git repos with auto package manager detection (npm, pnpm, yarn, Bun). TypeScript/Bun-native, triple-runtime (Bun/Node/Deno). Publishes compiled `.mjs` to npm, raw `.ts` to JSR.

## STRUCTURE

```text
repo-updater/
├── src/               # Core logic (orchestrator, runner, config, args, errors, changesets, workspaces)
├── __tests__/         # Dual-runner tests (Bun + Vitest via compat shim)
├── scripts/           # Utility scripts (cleanup, jsr version sync)
├── .github/workflows/ # CI (matrix: Bun latest/canary, Node 22/24), release, triage
└── assets/            # Static assets (excluded from linting)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| CLI entry (Bun/Node) | `src/cli.ts` | Thin wrapper, calls `main()` |
| CLI entry (Deno) | `src/deno-cli.ts` | Deno-specific entry with ambient `Deno` type |
| Main orchestration | `src/index.ts` | `main()`, `processRepo()`, `resolveRepos()`, browser detection (`~300 lines`) |
| Git/pm operations | `src/runner.ts` | `updateRepo()`, `detectPackageManager()`, exec abstraction |
| Argument parsing | `src/args.ts` | CLI flags |
| Config loading | `src/config.ts` | JSON config validation |
| Error types | `src/errors.ts` | TaggedError classes |
| Changeset management | `src/changesets.ts` | Snapshot, diff, write changeset files |
| Workspace detection | `src/workspaces.ts` | Workspace glob resolution, package discovery |
| Package JSON utility | `src/package-json.ts` | Read/parse package.json |
| Test compat shim | `__tests__/bun-test-compat.ts` | Maps `bun:test` imports to Vitest |
| CI config | `.github/workflows/ci.yml` | Typecheck + lint + build + test matrix |
| Release | `.github/workflows/release.yml` | Changeset-based, dual publish npm+JSR |

## CONVENTIONS

- **Runtime:** Bun primary, Node 22+ secondary, Deno tertiary (JSR publish)
- **Module:** ESM (`"type": "module"`)
- **TypeScript:** Strict, `noEmit` — type-check only via `tsgo` (Go-native TypeScript)
- **Build:** `tsdown` — not `tsc`. Three deps (`@clack/prompts`, `better-result`, `yaml`) marked `neverBundle`
- **Linting:** Ultracite (Biome preset) — `bun run check` / `bun run fix`
- **Testing:** Bun test primary, Vitest secondary (`bun test` / `bun run test:node`)
- **Error handling:** `better-result` TaggedError pattern with `_tag` discrimination
- **Versioning:** Changesets (`bun run version`) — chains `changeset version` → `sync:jsr` → lint fix
- **Git hooks:** Lefthook — ultracite fix → v8r → tsgo → cleanup → sync:jsr (on package.json change)
- **Deno sync:** `deno.json` version auto-synced to `package.json` via lefthook + `sync:jsr` script

## ANTI-PATTERNS (THIS PROJECT)

- **NEVER** leave repos in dirty state on failure — always cleanup branches
- **DO NOT** paste raw AI output into PRs/issues without review
- **DO NOT** publicly disclose security vulnerabilities (use private reporting)
- **AVOID** spawning real processes in tests — use mock `exec` functions
- **AVOID** breaking changes — use `--minor` flag for conservative updates

## UNIQUE STYLES

- **Result type:** `Result.gen()` async generators with `yield* Result.await()`, `Result.tryPromise()`
- **TaggedError:** All errors extend `TaggedError` with `_tag` for type discrimination
- **Dual exec:** `execBun()` for Bun runtime, `execNodejs()` for Node fallback
- **Branch naming:** `chore/dep-updates-{date}-{timestamp}` to avoid collisions
- **Dependency injection:** `main(argv?, updateFn?)` and `updateRepo(opts, execFn?)` accept override functions for testing
- **Runtime branching:** `typeof Bun === "undefined"` at runtime — no build-time conditionals
- **OIDC provenance:** npm publish with `NPM_CONFIG_PROVENANCE: true`, pinned `npm@11.12.0`

## COMMANDS

```bash
bun run start          # Run CLI
bun test               # Run tests (Bun, all 7 files)
bun run test:node      # Run tests (Vitest/Node, 6 files — excludes cli.test.ts)
bun run check          # Lint check (Ultracite)
bun run fix            # Fix lint issues
bun run typecheck      # Type check (tsgo, not tsc)
bun run version        # Bump version (changeset + jsr sync + lint)
bun run build          # Build dist/ (tsdown)
bun run sync:jsr       # Sync deno.json version to package.json
```

## NOTES

- **Package manager detection:** `bun.lock` → `pnpm-lock.yaml` → `yarn.lock` → `package-lock.json` (fallback: npm)
- **Config locations:** `./repo-updater.config.json` or `~/.config/repo-updater/config.json`
- **Default branch detection:** `git symbolic-ref refs/remotes/origin/HEAD`
- **PR creation:** `gh pr create` after pushing branch
- **Vitest compat:** `bun-test-compat.ts` shims `bun:test` → `vitest`; `cli.test.ts` excluded (uses `mock.module()`)
- **CI matrix:** Bun latest + canary (canary allowed to fail), Node 22 + 24
- **Release flow:** CI must pass → `release.yml` triggered via `workflow_run` → dual publish npm+JSR
- **tsdown customExports:** Programmatically rewrites `package.json` exports at build time — may drift from manual definition
