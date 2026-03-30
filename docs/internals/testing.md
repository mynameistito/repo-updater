# Testing internals

The test suite runs on two runtimes: Bun (primary) and Vitest on Node (secondary). Every test file imports from `"bun:test"` regardless of which runner executes it. Under Bun, this is the native test module. Under Vitest, `vitest.config.ts` maps `"bun:test"` to a compatibility shim at `__tests__/bun-test-compat.ts`.

## The compat shim

`__tests__/bun-test-compat.ts` re-exports Vitest equivalents under the same names that `bun:test` uses. The mapping:

| bun:test export | Vitest equivalent | Notes |
|---|---|---|
| `test` | `vitest test` | Direct alias |
| `describe` | `vitest describe` | Direct alias |
| `expect` | `vitest expect` | Direct alias |
| `mock` (the object) | `vi.fn` | Bun's `mock` object is a factory for mock functions; the shim maps it to `vi.fn` |
| `spyOn` | `vi.spyOn` | Direct alias |
| `mock.module()` | throws an error | No Vitest equivalent for Bun's ESM module interception |

One function intentionally breaks: `mock.module()`. Bun can intercept ESM imports at the module level, replacing an entire module with a mock. Vitest has no equivalent mechanism. Any test that calls `mock.module()` will fail under Vitest, which is why `cli.test.ts` is excluded from that runner.

## Why cli.test.ts is excluded from Vitest

The CLI test file uses `mock.module("@clack/prompts")` to replace the entire `@clack/prompts` package with mock objects. This requires Bun's native ESM interception, which Vitest cannot replicate. The file is excluded in `vitest.config.ts` via the `exclude` array. CLI tests run only under `bun test`.

## Two levels of dependency injection

The test strategy relies on injecting dependencies at two points rather than mocking the filesystem, network, or process spawning.

### Level 1: `updateRepo(opts, execFn = exec)` in `src/runner.ts`

The `execFn` parameter replaces all shell command execution. The default is the runtime-aware `exec()` function that actually spawns subprocesses (`execFn = exec`). Tests pass mock functions that return deterministic `Result` values and track which commands were executed. This single injection point mocks git operations, package manager commands, `gh pr create`, and every other subprocess call. A test can assert that `execFn` was called with `["git", "checkout", "-b", "chore/dep-updates-..."]` without running git at all.

### Level 2: `main(argv?, updateFn: typeof updateRepo = updateRepo)` in `src/index.ts`

The `updateFn` parameter replaces the entire `updateRepo` call (defaulting to `updateRepo` itself). CLI tests use this to bypass all git and package manager operations, testing only orchestration logic. Combined with `mock.module("@clack/prompts")`, this gives complete isolation for CLI-level tests.

The same pattern applies to `detectBrowser` and `openURLs` in `src/index.ts`, both of which accept an `execFn` parameter for the same reason.

## Mock patterns

The tests use a handful of recurring patterns.

The `ok()` factory returns `Promise.resolve(Result.ok({ stdout, stderr: "" }))`. This simulates a successful command without running anything. Tests call it like `ok("v2.0.0")` to pretend a command printed a version string.

The `makeExec(updatedDeps?)` factory simulates update commands that modify `package.json` on disk. It writes updated dependency versions to the real filesystem inside temporary directories, so subsequent reads see the changes. This is necessary because `updateRepo` reads `package.json` after running the update command to compute a changeset diff.

Command tracking works by having mock exec functions push command arrays to `executedCmds: string[][]`. After a test runs, assertions check which commands were called and with what arguments.

Module mocking uses `mock.module("@clack/prompts")` to replace the entire prompts package with mock objects: `logMock` (with `step`, `error`, `warn`, `info`, `success` methods), `spinnerInstance` (with `start` and `stop`), `confirmMock`, `intro`, `outro`, and `note`. This only works under Bun.

Console suppression uses `spyOn(console, "log").mockImplementation(() => undefined)` to keep test output clean.

Exit capture uses `spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); })`. Since `process.exit()` never returns, the mock throws instead, allowing the test to catch it with `await expect(fn()).rejects.toThrow("exit")`.

Deterministic filenames use `spyOn(Date, "now").mockReturnValue(9_999_999_999_999)` so that changeset filenames based on timestamps are predictable across runs.

## Test file summary

| File | Lines | Tests | What it covers |
|---|---|---|---|
| `args.test.ts` | 141 | 18 | `parseArgs` (all flags, edge cases, flag combinations), `getDate` |
| `config.test.ts` | 227 | 14 | `loadConfig` (valid, invalid, missing), `findConfigPath`, `saveBrowserToConfig`, `validateRepos` |
| `errors.test.ts` | 89 | 10 | `TaggedError` construction, `.is()` type guards |
| `runner.test.ts` | 802 | 30+ | `exec`, `detectPackageManager`, `getUpdateCommand`, `updateRepo` (dry-run, changeset, workspace, minor, cleanup) |
| `changesets.test.ts` | 436 | 30+ | `hasChangesets`, `snapshotDeps`, `diffDeps`, `writeChangesetFile`, workspace variants |
| `workspaces.test.ts` | 285 | 16 | `detectWorkspaces`, `resolveWorkspaceGlobs`, `getWorkspacePackages` |
| `cli.test.ts` | 883 | 30+ | `printUsage`, `resolveRepos`, `processRepo`, `main` (help flag, config loading, PR display, browser detection, browser opening) |

## Running tests

`bun test` runs all 7 test files on Bun. `bun run test:node` runs 6 files via Vitest on Node, skipping `cli.test.ts`. The compat shim at `__tests__/bun-test-compat.ts` makes this work by translating `bun:test` imports into their Vitest equivalents.
