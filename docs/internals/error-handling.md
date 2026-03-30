# Error handling in repo-updater

All errors in repo-updater go through the `better-result` library. `better-result` is one of only three runtime dependencies. The project uses `Result<T, E>` instead of thrown exceptions for every operation that can fail, and `TaggedError` classes for type-safe error discrimination.

## TaggedError pattern

Each error type is defined in `src/errors.ts` using `TaggedError` from `better-result`. The call to `TaggedError("ErrorName")<{ properties }>()` produces two things: a class constructor (used to create error instances) and an instance type (used for narrowing in `Result.isErr` checks). Every instance carries a `_tag` string literal that identifies the error variant, which enables exhaustiveness checking in `switch` and `if` chains. `TaggedError` also provides a static `.is()` method for type guard checks.

Here is the definition of `CommandFailedError` as an example:

```ts
export const CommandFailedError: TaggedErrorClass<
  "CommandFailedError",
  { message: string; command: string; stderr: string }
> = TaggedError("CommandFailedError")<{
  message: string;
  command: string;
  stderr: string;
}>();

export type CommandFailedError = InstanceType<typeof CommandFailedError>;
```

The `const` holds the class. The `type` alias (same name) holds the instance type. This dual-export pattern repeats for every error in the file.

## The five error classes

| Class | Properties | Where used |
|---|---|---|
| `CommandFailedError` | `message`, `command`, `stderr` | `src/runner.ts`, when a subprocess exits non-zero |
| `ConfigNotFoundError` | `message` | `src/config.ts`, when no config file exists at any searched path |
| `ConfigParseError` | `message` | `src/config.ts`, when config JSON is malformed or missing required fields |
| `InvalidInputError` | `message` | `src/runner.ts`, when date string validation fails |
| `DirectoryNotFoundError` | `message`, `path` | Defined in `src/errors.ts` but not currently referenced from `src/` code. Available for future use. |

## Result type basics

`better-result` provides `Result<T, E>` with two main construction patterns.

### Wrapping throwing code

`Result.try()` (sync) and `Result.tryPromise()` (async) take a `try` function and a `catch` function. If `try` throws, the error is caught and mapped into an `Err` value. `loadConfig` in `src/config.ts` uses `Result.try` to parse a JSON file and validate its shape:

```ts
return Result.try({
  try: () => {
    const raw = JSON.parse(readFileSync(found, "utf-8")) as unknown;

    if (
      !raw ||
      typeof raw !== "object" ||
      !("repos" in raw) ||
      !Array.isArray((raw as { repos: unknown }).repos) ||
      !(raw as { repos: unknown[] }).repos.every(
        (r: unknown) => typeof r === "string"
      )
    ) {
      throw new Error("Config must contain a 'repos' array");
    }

    return raw as Config;
  },
  catch: (e) =>
    new ConfigParseError({
      message: `Failed to parse ${found}: ${e instanceof Error ? e.message : String(e)}`,
    }),
});
```

### Async generator sequences

`Result.gen()` accepts an async generator function. Inside the generator, `yield* Result.await(promiseOfResult)` unwraps a `Result` value. If the result is `Err`, the generator short-circuits and returns that `Err` immediately. If it is `Ok`, the generator continues with the unwrapped value. This gives you early-return semantics without nested `if (result.isErr())` checks.

The `updateRepo` function in `src/runner.ts` chains a long sequence of shell commands this way. A simplified excerpt:

```ts
return Result.gen(async function* () {
  const defaultBranchResult = yield* Result.await(
    execFn(["git", "symbolic-ref", "refs/remotes/origin/HEAD"], repo)
  );

  yield* Result.await(execFn(["git", "checkout", defaultBranch], repo));
  yield* Result.await(execFn(["git", "pull"], repo));
  yield* Result.await(execFn(["git", "checkout", "-b", branch], repo));

  yield* Result.await(execFn(updateCmd, repo));
  yield* Result.await(execFn(getInstallCommand(pm), repo));

  const status = yield* Result.await(
    execFn(["git", "status", "--porcelain"], repo)
  );
  // ...
});
```

If any `execFn` call returns `Err`, the generator stops right there. The caller receives the `Err` without executing any further commands.

## Error propagation through layers

Errors originate in two places and flow upward through the call stack.

`src/runner.ts` returns `Result<RepoResult, CommandFailedError | InvalidInputError>` from `updateRepo`. The `exec` function wraps subprocess calls with `Result.tryPromise` and maps non-zero exit codes into `CommandFailedError`. Date validation maps bad input into `InvalidInputError` before any shell commands run.

`src/config.ts` returns `Result<Config, ConfigNotFoundError | ConfigParseError>` from `loadConfig`. A missing file becomes `ConfigNotFoundError`. A malformed or invalid file becomes `ConfigParseError`.

`src/index.ts` consumes both. `resolveRepos` calls `loadConfig` and checks `configResult.isErr()` to log the error and exit. `processRepo` calls `updateRepo`, checks `result.isErr()`, and logs the error message and stderr. Neither layer catches and swallows errors; they propagate until they reach a boundary that knows how to present them.

The CLI entry points (`src/cli.ts` for Bun/Node, `src/deno-cli.ts` for Deno) sit at the top of the stack. Both attach a `.catch()` handler to the `main()` promise. If anything throws past the `Result` layer (which should not happen in normal operation), the handler logs the error and exits with code 1.

## Cleanup on failure

`updateRepo` in `src/runner.ts` uses a `try/finally` pattern to guarantee that repositories are never left in a dirty state. A local `succeeded` flag starts as `false`. If the function reaches a successful return, it sets `succeeded = true` before returning. The `finally` block checks the flag and calls `performCleanup` if it is still `false`.

```ts
let succeeded = false;
try {
  // ... git operations, update commands, commit, push ...
  succeeded = true;
  return Result.ok({ repo, status: "pr-created" });
} finally {
  if (!succeeded) {
    await performCleanup({
      defaultBranch,
      branch,
      branchCreated,
      branchPushed,
      execFn,
      repo,
      changesetFile: changesetFilePath,
    });
  }
}
```

`performCleanup` (defined in the same file) runs a sequence of rollback steps. Each step is individually tolerant of failure: if a step fails, it logs a warning and moves on to the next step. The steps are:

1. Delete the changeset file from disk (if one was written).
2. Run `git reset --hard HEAD` to discard staged and unstaged changes.
3. Check out the default branch.
4. Delete the remote branch (only if it was pushed).
5. Delete the local branch.

```ts
async function performCleanup({
  defaultBranch,
  branch,
  branchCreated,
  branchPushed,
  execFn,
  repo,
  changesetFile,
}: CleanupOptions): Promise<void> {
  if (!branchCreated) return;

  if (changesetFile && existsSync(changesetFile)) {
    try {
      unlinkSync(changesetFile);
    } catch {
      console.warn(`Cleanup: Could not remove changeset file: ${changesetFile}`);
    }
  }

  const resetResult = await execFn(["git", "reset", "--hard", "HEAD"], repo);
  if (resetResult.isErr()) {
    console.warn(`Cleanup: Failed to reset worktree: ${resetResult.error.message}`);
  }

  const checkoutResult = await execFn(["git", "checkout", defaultBranch], repo);
  if (checkoutResult.isErr()) {
    console.warn(`Cleanup: Failed to checkout ${defaultBranch}: ${checkoutResult.error.message}`);
  }

  if (branchPushed) {
    const deleteRemoteResult = await execFn(
      ["git", "push", "origin", "--delete", branch],
      repo
    );
    if (deleteRemoteResult.isErr()) {
      console.warn(`Cleanup: Could not delete remote branch ${branch}: ${deleteRemoteResult.error.message}`);
    }
  }

  const deleteResult = await execFn(["git", "branch", "-D", branch], repo);
  if (deleteResult.isErr()) {
    console.warn(`Cleanup: Failed to delete branch ${branch}: ${deleteResult.error.message}`);
  }
}
```

The "no changes" path also sets `succeeded = true`, but it handles its own cleanup inline: it checks out the default branch and deletes the local branch before returning. This is a separate early exit that does not go through `performCleanup`.
