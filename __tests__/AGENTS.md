# __tests__/ KNOWLEDGE BASE

## OVERVIEW

Test directory with Bun/Vitest dual-runner support via compatibility shim.

## STRUCTURE

```
__tests__/
├── bun-test-compat.ts    # Vitest shim — re-exports vitest equivalents as "bun:test"
├── errors.test.ts        # TaggedError behavior
├── args.test.ts          # CLI argument parsing
├── config.test.ts        # Config load/validate
├── workspaces.test.ts    # Workspace resolution
├── changesets.test.ts    # Changeset file operations
├── runner.test.ts        # Core update workflow (largest test suite)
└── cli.test.ts           # CLI integration — Bun-only (excluded from Vitest)
```

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Runner tests | `runner.test.ts` | Mock exec injection, command tracking, workspace + non-workspace paths |
| Config tests | `config.test.ts` | Config validation, default branch fallback |
| CLI tests | `cli.test.ts` | `mock.module()` for `@clack/prompts` — **Bun-only** |
| Changeset tests | `changesets.test.ts` | Snapshot, diff, write; `(new)` / `(removed)` placeholders |
| Workspace tests | `workspaces.test.ts` | Glob resolution, package discovery |

## CONVENTIONS

- **Import:** All tests use `import { ... } from "bun:test"` — Vitest alias rewrites this to the compat shim
- **isBun detection:** Define locally per file: `const isBun = typeof globalThis.Bun !== "undefined"`
- **Conditional skip:** `test.skipIf(!isBun)("...", () => ...)` for Bun-specific tests
- **Temp dirs:** `mkdtempSync(join(tmpdir(), "prefix-"))` in `beforeEach`, `rmSync` in `afterEach`
- **Mock exec:** Pass to `updateRepo(opts, mockExec)` — never spawn real processes
- **Spy pattern:** `spyOn(console, "log").mockImplementation(() => {})` with `.mockRestore()`
- **Result assertions:** `expect(result.isErr()).toBe(true)` then narrow with `if (result.isErr()) { ... }`

## ANTI-PATTERNS

- **DO NOT** run `cli.test.ts` under Vitest — uses `mock.module()` (Bun-specific)
- **AVOID** spawning real processes — pass mock `exec` to `updateRepo()`
- **AVOID** real git operations in tests — mock `execFn` parameter
- **DO NOT** share test helpers across files — each file defines inline factories (`ok()`, `makeExec()`, etc.)

## KEY PATTERNS

```typescript
// Mock exec for testing
const mockExec = async () => Result.ok({ stdout: "", stderr: "" });
await updateRepo({ repo, date, dryRun: false }, mockExec);

// Command-tracking mock
const executedCmds: string[][] = [];
const trackingExec = (cmd, cwd) => { executedCmds.push(cmd); return baseMock(cmd, cwd); };

// Deterministic file naming
const dateNowSpy = spyOn(Date, "now").mockReturnValue(9_999_999_999_999);

// process.exit spy (cli.test.ts only)
exitSpy = spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
await expect(main(["--help"], noopUpdate)).rejects.toThrow("exit");
```

## NOTES

- `bun-test-compat.ts` exports: `afterAll`, `afterEach`, `beforeAll`, `beforeEach`, `describe`, `expect`, `it`, `test`, `mock`, `spyOn`
- `mock()` maps to `vi.fn()`; `mock.module()` throws (Bun-specific API, cannot be trivially shimmed — use `vi.mock()` / `vi.doMock()` directly)
- `vitest.config.ts` excludes `cli.test.ts` via `exclude: ["__tests__/cli.test.ts"]`
- Two console-suppression styles coexist: manual stub-and-restore (`args.test.ts`) and `spyOn` (`runner.test.ts`)
