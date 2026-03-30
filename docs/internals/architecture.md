# Architecture and data flow

## Layer diagram

The codebase is organized into five layers. Higher layers orchestrate lower layers. Lower layers have no knowledge of the layers above them.

```text
Layer 4  Entry points       cli.ts, deno-cli.ts
Layer 3  Orchestrator       index.ts
Layer 2  Core engine        runner.ts
Layer 1  Domain modules     config.ts, workspaces.ts, changesets.ts
Layer 0  Leaf utilities     args.ts, errors.ts, package-json.ts
```

Layer 0 has zero internal imports. These modules are pure data-in, data-out with no dependency on other project files. `args.ts` turns `process.argv` into a typed struct. `errors.ts` defines the `TaggedError` variants. `package-json.ts` reads and parses a `package.json` file.

Layer 1 modules handle a single domain concern. `config.ts` loads, validates, and persists JSON config files. `workspaces.ts` detects monorepo workspace layouts by reading `pnpm-workspace.yaml` and `package.json` workspaces fields, then resolving glob patterns to concrete package directories. `changesets.ts` snapshots dependency versions, diffs before and after states, and writes `.changeset/*.md` files.

Layer 2 is the core update engine. `runner.ts` contains `updateRepo`, the ~300-line function that performs the full dependency update cycle on a single repository: detect the package manager, create a branch, run updates, commit, push, and open a PR. It delegates workspace detection to Layer 1 and filesystem checks to Layer 0.

Layer 3 is the orchestrator. `index.ts` owns `main()`, which ties everything together: parse args, load config, validate repos, iterate over each repo calling `processRepo` (which calls into `updateRepo`), then collect PR URLs and offer to open them in the browser. It also contains the cross-platform browser detection subsystem (~300 lines for macOS, Windows, and Linux).

Layer 4 are thin entry points with no logic of their own. `cli.ts` calls `main()` and exits on failure. `deno-cli.ts` does the same but passes `Deno.args` instead of `process.argv.slice(2)`.

## Module dependency graph

```text
cli.ts ─────────────────────────┐
                                v
deno-cli.ts ──────────────> index.ts ──> @clack/prompts
                                       ├──> args.ts
                                       ├──> config.ts ──> errors.ts
                                       └──> runner.ts ──> changesets.ts ──> package-json.ts
                                                           ├──> errors.ts          └──> workspaces.ts (type only)
                                                           └──> workspaces.ts ──> package-json.ts
                                                                                 └──> yaml
```

`cli.ts` and `deno-cli.ts` import only from `index.ts`. `index.ts` is the single consumer of `args.ts`, `config.ts`, and `runner.ts`. `runner.ts` reaches into Layer 1 (changesets, workspaces) and Layer 0 (errors). `changesets.ts` imports `workspaces.ts` for the `WorkspacePackage` type only (no runtime dependency). No module in the project has a circular import.

## Startup flow

`main(argv?, updateFn?)` in `index.ts` runs these steps in order.

1. `parseArgs(argv)` converts raw argument strings into a `ParsedArgs` struct. If `--help` was passed, it prints usage and exits.
2. `resolveRepos(args)` determines which repositories to process. If positional arguments were given, those paths are used directly (with config still loaded for the `browser` field). Otherwise the `repos` array from the config file is used. Returns `null` if no config exists and no positional args were given, which causes an early exit.
3. `validateRepos(resolved.repos)` partitions the repo paths into three buckets: `valid` (directory exists and contains `.git`), `missing` (directory does not exist), and `notGit` (directory exists but is not a git repo). Warnings are logged for the latter two.
4. If `--browser` was passed, `saveBrowserToConfig` persists the browser preference to the config file for future runs.
5. For each repo in `valid`, `processRepo` is called. It wraps the call to `updateRepo` with spinner UI and error reporting. Results are accumulated into a `prUrls` array.
6. If any PRs were created, their URLs are displayed and the user is prompted to open them in the browser.

## updateRepo flow

`updateRepo(options, execFn?)` in `runner.ts` is the core workflow. It returns a `Result<RepoResult, CommandFailedError | InvalidInputError>` and runs these steps sequentially.

1. Validate the date string against `YYYY-MM-DD` format using `isValidCalendarDate`. Return an `InvalidInputError` immediately if invalid.
2. Generate a branch name: `chore/dep-updates-{date}-{timestamp}`, where `timestamp` is `Date.now()`. The timestamp suffix prevents collisions when the tool runs multiple times in one day.
3. If dry-run: delegate to `dryRunRepo`, which prints the steps that would execute and returns a synthetic result.
4. Detect the package manager by scanning for lockfiles in priority order.
5. Detect the default branch by running `git symbolic-ref refs/remotes/origin/HEAD` and extracting the branch name from the output. Falls back to `"main"`.
6. Run `git checkout` on the default branch, then `git pull` to get the latest.
7. Run `git checkout -b` to create the new branch.
8. Call `prepareWorkspaceContext`, which checks if the repo is a monorepo. If workspaces are detected, it snapshots workspace deps before updating. If not, it snapshots root deps. The appropriate update command is selected based on workspace vs. single-package mode.
9. Run the package manager update command.
10. Run the package manager install command.
11. Call `handleChangesets`, which snapshots deps after the update, diffs against the before snapshot, and writes a `.changeset/dep-updates-{timestamp}.md` file if there are changes and the repo uses changesets.
12. Run `git status --porcelain`. If stdout is empty, there are no changes: switch back to the default branch, delete the update branch, and return `"no-changes"`.
13. If there are changes: `git add -A`, `git commit`, `git push -u origin`, then `gh pr create` with the title `Dep Updates {date}`.
14. On failure at any point after branch creation, `performCleanup` runs in a `finally` block: hard-reset the worktree, switch back to the default branch, delete the remote branch if it was pushed, delete the local branch, and remove the changeset file if one was written.

The async generator pattern used throughout:

```ts
return Result.gen(async function* () {
  const pm = detectPackageManager(repo);

  const defaultBranchResult = yield* Result.await(
    execFn(["git", "symbolic-ref", "refs/remotes/origin/HEAD"], repo)
  );

  yield* Result.await(execFn(["git", "checkout", defaultBranch], repo));
  yield* Result.await(execFn(["git", "pull"], repo));

  // ... more steps

  return Result.ok({ repo, status: "pr-created", prUrl: pr.stdout });
});
```

Each `yield* Result.await()` either unwraps the `Ok` value or short-circuits the generator by returning the `Err`. This means any failed command immediately returns the error to the caller without executing subsequent steps.

## Post-processing flow

After all repos have been processed, `main` checks the accumulated `prUrls` array.

If PRs were created, `handlePRDisplay` shows the URLs in a `@clack/prompts` note block and asks the user whether to open them in the browser. On confirmation, `openURLs` is called.

`openURLs` first determines the browser to use. If a `--browser` flag or config value exists, that path is used directly. Otherwise `detectBrowser` probes the OS for the default browser, dispatching to platform-specific functions:

- macOS: reads `com.apple.LaunchServices` defaults to check if Firefox is the handler (Firefox needs special treatment because of single-instance locking). Falls back to `open` if detection fails.
- Windows: queries the registry via PowerShell to get the actual executable path for the `https` URL association. Falls back to `reg query` prog ID mapping, then to known browser names.
- Linux: runs `xdg-settings get default-web-browser` and maps the `.desktop` file name to a command.

Once the browser is resolved, `buildOpenCommands` constructs the appropriate command arrays. All URLs are batched into a single command when possible (passing multiple URLs to one browser invocation). On Windows with no detected browser, each URL falls back to `cmd /c start`.

## Runtime branching

The same source code runs on three runtimes without build-time conditionals.

Bun and Node share the entry point `cli.ts`. The runtime is detected at call sites using the pattern:

```ts
typeof Bun === "undefined"
```

When this check is true, the code is running under Node and selects the Node path (e.g., `execNodejs` instead of `execBun`, or `openURLNodejs` instead of `openURLBun`). When false, the Bun runtime is available and its native APIs are used directly.

Deno uses a separate entry point, `deno-cli.ts`. It declares an ambient `Deno` type with `declare const Deno: { args: string[]; exit(code?: number): never }` instead of importing `@types/deno`, which would contaminate the Bun/Node type-check pass. This entry point passes `Deno.args` to `main()` and uses `Deno.exit()` instead of `process.exit()`.

## Package manager commands

### Root-only updates

| Package manager | Latest mode | Minor mode |
|---|---|---|
| npm | `npx --yes npm-check-updates --upgrade` | `npm update` |
| pnpm | `pnpm update --latest` | `pnpm update` |
| yarn | `yarn upgrade --latest` | `yarn upgrade` |
| bun | `bun update --latest` | `bun update` |

### Workspace (monorepo) updates

| Package manager | Latest mode | Minor mode |
|---|---|---|
| npm | `npx --yes npm-check-updates --upgrade --workspaces` | `npm update --workspaces` |
| pnpm | `pnpm update --latest -r` | `pnpm update -r` |
| yarn | `npx --yes npm-check-updates --upgrade --workspaces` | `npx --yes npm-check-updates --upgrade --target minor --workspaces` |
| bun | `bun update --latest` | `bun update` |

Bun handles workspaces natively with `bun update`, so no separate workspace command is needed. npm and yarn use `npm-check-updates` for latest-mode workspace updates because neither has a built-in `--latest` flag that covers all workspace packages.

### Install commands (shared across modes)

| Package manager | Command |
|---|---|
| npm | `npm install` |
| pnpm | `pnpm install` |
| yarn | `yarn install` |
| bun | `bun install` |

### Lockfile detection

The package manager is detected by checking for lockfiles in priority order. The first match wins:

```ts
export function detectPackageManager(repoPath: string): PackageManager {
  const checks: Array<{ file: string; pm: PackageManager }> = [
    { file: "bun.lock", pm: "bun" },
    { file: "pnpm-lock.yaml", pm: "pnpm" },
    { file: "yarn.lock", pm: "yarn" },
    { file: "package-lock.json", pm: "npm" },
  ];

  for (const { file, pm } of checks) {
    if (existsSync(join(repoPath, file))) {
      return pm;
    }
  }
  return "npm";
}
```

If no lockfile is found, the tool assumes npm.
