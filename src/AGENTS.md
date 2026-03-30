# src/ KNOWLEDGE BASE

## OVERVIEW

Core source directory — CLI entry points, repository update orchestration, and utility modules.

## STRUCTURE

```
src/
├── cli.ts            # Bun/Node entry (thin wrapper → main())
├── deno-cli.ts       # Deno entry (ambient Deno type, no @types/deno)
├── index.ts          # Orchestrator: main(), processRepo(), resolveRepos(), browser detection
├── runner.ts         # Git/pm operations: updateRepo(), detectPackageManager(), exec()
├── args.ts           # CLI argument parsing
├── config.ts         # JSON config load + validate
├── errors.ts         # TaggedError definitions
├── changesets.ts     # Changeset snapshot/diff/write
├── workspaces.ts     # Workspace glob resolution, package discovery
└── package-json.ts   # package.json read/parse helper
```

## WHERE TO LOOK

| Task | File | Key Functions |
|------|------|---------------|
| CLI bootstrap (Bun/Node) | `cli.ts` | `main().catch()` → `process.exit(1)` |
| CLI bootstrap (Deno) | `deno-cli.ts` | `main(Deno.args)` with `declare const Deno` |
| Orchestration | `index.ts` | `main()`, `processRepo()`, `resolveRepos()`, `openURLs()`, browser detection |
| Update workflow | `runner.ts` | `updateRepo()`, `detectPackageManager()`, `performCleanup()`, exec abstraction |
| CLI args | `args.ts` | `parseArgs()`, `getDate()` |
| Config | `config.ts` | `loadConfig()`, `validateRepos()` |
| Errors | `errors.ts` | `CommandFailedError`, `ConfigNotFoundError`, `InvalidInputError` |
| Changesets | `changesets.ts` | `snapshotChangesetFiles()`, `getChangesetDiff()`, `writeChangesetFile()`, `getPackageName()` |
| Workspaces | `workspaces.ts` | `resolveWorkspaces()`, `getWorkspacePackages()` |
| Package JSON | `package-json.ts` | `readPackageJson()` |

## CONVENTIONS

- **exports:** `index.ts` exports `main()` as public API; `cli.ts` is entry wrapper
- **Error handling:** All errors use `TaggedError` from `better-result`
- **Async pattern:** `Result.gen()` for async operations with error propagation (`yield* Result.await()`)
- **Exec abstraction:** `exec()` wraps Bun/Node spawn, returns `Result<ExecOutput, CommandFailedError>`
- **Runtime branching:** `typeof Bun === "undefined"` — no build-time conditionals
- **Dependency injection:** `main(argv?, updateFn?)` passes override through to `updateRepo(opts, execFn?)`

## ANTI-PATTERNS

- **AVOID** arbitrary `console.log` in `runner.ts` — prefix with `[info]` for user-facing messages only
- **NEVER** skip cleanup on failure — `performCleanup()` handles branch rollback
- **NEVER** hardcode branch names — use timestamp suffix to avoid collisions
- **AVOID** checking `getChangesetFiles().length === 0` — active repos have pre-existing changesets on `main`; check for specific target file instead

## UNIQUE STYLES

```typescript
// Result type with async generator
return Result.gen(async function* () {
  const result = yield* Result.await(execFn(["git", "status"], repo));
});

// TaggedError definition
export const CommandFailedError = TaggedError("CommandFailedError")<{
  message: string;
  command: string;
  stderr: string;
}>();

// Package manager detection priority
const checks = [
  { file: "bun.lock", pm: "bun" },
  { file: "pnpm-lock.yaml", pm: "pnpm" },
  { file: "yarn.lock", pm: "yarn" },
  { file: "package-lock.json", pm: "npm" },
];
```

## NOTES

- `index.ts` is ~650 lines — browser detection subsystem accounts for ~300 lines (macOS/Windows/Linux)
- `deno-cli.ts` declares `Deno` with ambient `declare const` instead of `@types/deno` to avoid contaminating the Bun/Node type-check pass
- Use `getPackageName()` from `changesets.ts` — do not inline `JSON.parse` for package.json reading
- Dry-run step order must exactly match `updateRepo` execution order — changeset write happens before `git status --porcelain`
