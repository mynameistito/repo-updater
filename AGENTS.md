# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-25
**Commit:** 5e30284
**Branch:** main

## OVERVIEW

CLI tool to mass-update dependencies across multiple git repositories with auto package manager detection (npm, pnpm, yarn, Bun). TypeScript/Bun-native, publishes raw TS source.

## STRUCTURE

```
repo-updater/
├── src/           # Core logic (cli, runner, config, args, errors)
├── __tests__/     # Bun/Vitest tests with compat shim
├── scripts/       # Utility scripts (cleanup)
└── assets/        # Static assets
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| CLI entry point | `src/cli.ts` | Thin wrapper, calls `main()` |
| Main logic | `src/index.ts` | Orchestrates repo processing |
| Git/package manager ops | `src/runner.ts` | Core update workflow |
| Argument parsing | `src/args.ts` | CLI flags |
| Config loading | `src/config.ts` | JSON config validation |
| Error types | `src/errors.ts` | TaggedError classes |
| Changeset management | `src/changesets.ts` | Snapshot, diff, and write changeset files for dep updates |
| Workspace detection | `src/workspaces.ts` | Workspace glob resolution and package discovery |
| Package JSON reading | `src/package-json.ts` | Utility to read and parse package.json |

## CONVENTIONS

- **Runtime:** Bun-first, Node 22+ supported
- **Module:** ESM (`"type": "module"`)
- **TypeScript:** Strict mode, `noEmit` (type-check only)
- **Linting:** Ultracite (Biome-based) - `bun run check` / `bun run fix`
- **Testing:** Bun test primary, Vitest secondary (`bun test` / `bun run test:node`)
- **Error handling:** `better-result` TaggedError pattern with `_tag` discrimination
- **Versioning:** Changesets (`bun run version`)

## ANTI-PATTERNS (THIS PROJECT)

- **NEVER** leave repos in dirty state on failure - always cleanup branches
- **DO NOT** paste raw AI output into PRs/issues without review
- **DO NOT** publicly disclose security vulnerabilities (use private reporting)
- **AVOID** spawning real processes in tests - use mock `exec` functions
- **AVOID** breaking changes - use `--minor` flag for conservative updates

## UNIQUE STYLES

- **Result type:** Uses `better-result` library - `Result.tryPromise()`, `Result.gen()`, `Result.isOk()` / `Result.isErr()`
- **TaggedError:** All errors extend `TaggedError` with `_tag` property for type discrimination
- **Dual exec:** `execBun()` for Bun runtime, `execNodejs()` for Node fallback
- **Branch naming:** `chore/dep-updates-{date}-{timestamp}` to avoid collisions

## COMMANDS

```bash
bun run start          # Run CLI
bun test               # Run tests (Bun)
bun run test:node      # Run tests (Vitest/Node)
bun run check          # Lint check
bun run fix            # Fix lint issues
bun run typecheck      # Type check (tsgo)
bun run version        # Bump version (changesets)
```

## NOTES

- **Package manager detection:** Checks for `bun.lock` → `pnpm-lock.yaml` → `yarn.lock` → `package-lock.json` (falls back to npm)
- **Config locations:** `./repo-updater.config.json` or `~/.config/repo-updater/config.json`
- **Default branch detection:** Uses `git symbolic-ref refs/remotes/origin/HEAD`
- **PR creation:** Uses `gh pr create` after pushing branch
- **Test compatibility:** `__tests__/bun-test-compat.ts` shims `bun:test` to `vitest` for Node testing
- **Some tests excluded from Vitest:** `cli.test.ts` uses `mock.module()` (Bun-specific)
