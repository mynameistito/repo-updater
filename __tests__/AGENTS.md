# __tests__/ KNOWLEDGE BASE

## OVERVIEW

Test directory with Bun/Vitest dual-runner support. Uses compatibility shim for Node.js testing.

## WHERE TO LOOK

| Task | File | Purpose |
|------|------|---------|
| Runner tests | `runner.test.ts` | Core update workflow tests |
| Config tests | `config.test.ts` | Config loading/validation |
| Args tests | `args.test.ts` | CLI argument parsing |
| Errors tests | `errors.test.ts` | Error type behavior |
| CLI tests | `cli.test.ts` | CLI integration (Bun-only) |
| Compat shim | `bun-test-compat.ts` | Maps `bun:test` to `vitest` |

## CONVENTIONS

- **Import:** `import { describe, it, expect, beforeEach, afterEach } from "bun:test"`
- **Dual runner:** Same code runs under `bun test` and `vitest run`
- **Compat shim:** `vitest.config.ts` aliases `bun:test` → `vitest`
- **isBun detection:** Define locally: `const isBun = typeof globalThis.Bun !== "undefined";`
- **Conditional skip:** `test.skipIf(!isBun)("...", () => ...)` for Bun-specific tests
- **Mock pattern:** `spyOn(console, "log").mockImplementation(() => {})` with `.mockRestore()`
- **Temp dirs:** `beforeEach` creates `tmpdir`, `afterEach` cleans up with `rmSync(..., { recursive: true, force: true })`

## ANTI-PATTERNS

- **DO NOT** run `cli.test.ts` under Vitest - uses `mock.module()` (Bun-specific)
- **AVOID** spawning real processes - pass mock `exec` to `updateRepo()`
- **AVOID** real git operations in tests - mock `execFn` parameter

## TEST PATTERNS

```typescript
// Result type testing
const result = await updateRepo({ repo, date: "2024-01-01", dryRun: true });
expect(Result.isOk(result)).toBe(true);
// Mock exec for testing
const mockExec = async () => Result.ok({ stdout: "", stderr: "" });
await updateRepo({ repo, date, dryRun: false }, mockExec);

// Skip Bun-specific tests under Node
const isBun = typeof globalThis.Bun !== "undefined";
test.skipIf(!isBun)("bun-specific test", () => { ... });

// Spy pattern
const logSpy = spyOn(console, "log").mockImplementation(() => {});
// ... test code ...
logSpy.mockRestore();
```

## NOTES

- `bun-test-compat.ts` exports: `afterAll`, `afterEach`, `beforeAll`, `beforeEach`, `describe`, `expect`, `it`, `test`, `mock`, `spyOn`
- Vitest config excludes `cli.test.ts` via `exclude: ["__tests__/cli.test.ts"]`
- Tests use `better-result` `Result.isOk()` / `Result.isErr()` for assertions
