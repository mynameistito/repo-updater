# src/ KNOWLEDGE BASE

## OVERVIEW

Core source directory - CLI entry point, repository update orchestration, and utility modules.

## WHERE TO LOOK

| Task | File | Key Functions |
|------|------|---------------|
| CLI bootstrap | `cli.ts` | `main().catch()` |
| Orchestration | `index.ts` | `main()`, `processRepo()`, `resolveRepos()`, `openURLs()` |
| Update workflow | `runner.ts` | `updateRepo()`, `detectPackageManager()`, `exec()` |
| CLI args | `args.ts` | `parseArgs()`, `getDate()` |
| Config | `config.ts` | `loadConfig()`, `validateRepos()` |
| Errors | `errors.ts` | `CommandFailedError`, `ConfigNotFoundError`, `InvalidInputError` |

## CONVENTIONS

- **exports:** `index.ts` exports `main()` as public API; `cli.ts` is entry wrapper
- **Error handling:** All errors use `TaggedError` from `better-result`
- **Async pattern:** `Result.gen()` for async operations with error propagation (`yield* Result.await()`)
- **Exec abstraction:** `exec()` wraps Bun/Node spawn, returns `Result<ExecOutput, CommandFailedError>`

## ANTI-PATTERNS

- **AVOID** arbitrary `console.log` in `runner.ts` - prefix with `[info]` for user-facing messages only
- **NEVER** skip cleanup on failure - `performCleanup()` handles branch rollback
- **NEVER** hardcode branch names - use timestamp suffix to avoid collisions
- **AVOID** checking `getChangesetFiles().length === 0` - active repos have pre-existing changesets on `main`; check for specific target file instead

## KEY PATTERNS

```typescript
// Result type with async generator
return Result.gen(async function* () {
  const result = yield* Result.await(execFn(["git", "status"], repo));
  // ...
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

- **Changesets module:** `changesets.ts` has `readPackageJson` helper with error handling - use `getPackageName()` instead of inline `JSON.parse`
- **Dry-run parity:** `dryRunRepo` step order must match `updateRepo` execution order exactly - changeset write happens before `git status --porcelain`
