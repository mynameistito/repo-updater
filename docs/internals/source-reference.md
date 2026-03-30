# Source file reference

A file-by-file reference for every source file in `src/`. Each entry lists what the file exports, what it keeps private, and which other source files import it.

---

## src/errors.ts (87 lines)

Defines five TaggedError classes used throughout the codebase for typed error discrimination. Each error extends `TaggedError` from `better-result` with a unique `_tag` string and typed properties.

Exported types:

```ts
type DirectoryNotFoundError   // InstanceType<typeof DirectoryNotFoundError>
type CommandFailedError      // InstanceType<typeof CommandFailedError>
type ConfigNotFoundError     // InstanceType<typeof ConfigNotFoundError>
type ConfigParseError        // InstanceType<typeof ConfigParseError>
type InvalidInputError       // InstanceType<typeof InvalidInputError>
```

All five follow the same pattern. Each is both a `TaggedErrorClass` (static side) and an instance type (value side) exported from the same name:

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

Properties per error class:

- `DirectoryNotFoundError`: `message`, `path`
- `CommandFailedError`: `message`, `command`, `stderr`
- `ConfigNotFoundError`: `message`
- `ConfigParseError`: `message`
- `InvalidInputError`: `message`

Imported by: `config.ts` (ConfigNotFoundError, ConfigParseError), `runner.ts` (CommandFailedError, InvalidInputError).

---

## src/package-json.ts (25 lines)

Reads and parses a `package.json` from a directory, returning null on any failure. Uses `node:fs` sync APIs (`existsSync`, `readFileSync`).

Exported functions:

```ts
readPackageJson(dir: string): Record<string, unknown> | null
```

Joins `dir` with `package.json`, reads the file, parses JSON, and returns the resulting object. Returns `null` if the file does not exist or if `JSON.parse` throws.

Imported by: `changesets.ts`, `workspaces.ts`.

---

## src/args.ts (121 lines)

CLI argument parser. No external dependencies. Converts raw `process.argv` strings into a typed `ParsedArgs` object.

Exported types:

```ts
interface ParsedArgs {
  browser: string | undefined;
  configPath: string | undefined;
  dryRun: boolean;
  help: boolean;
  minor: boolean;
  noChangeset: boolean;
  noWorkspaces: boolean;
  positional: string[];
}
```

Exported functions:

- `parseArgs(argv: string[]): ParsedArgs` -- walks the argv array using `Symbol.iterator`, matching boolean flags from a lookup map (`-h`/`--help`, `-n`/`--dry-run`, `-m`/`--minor`, `--no-changeset`, `--no-workspaces`) and consuming the next value for `--config`/`-c` and `--browser`/`-b`. Everything else goes into `positional`.
- `getDate(): string` -- returns the current local date as `YYYY-MM-DD`.

Non-exported internals:

- `BooleanFlag` type alias (union of the five flag names)
- `BOOLEAN_FLAGS` record mapping flag strings to their canonical key

Imported by: `index.ts`.

---

## src/config.ts (209 lines)

Configuration file loading, validation, and persistence. Searches two locations for `repo-updater.config.json`: the current working directory and `~/.config/repo-updater/config.json`. All I/O operations use sync `node:fs` functions. Returns `Result` types from `better-result`.

Exported types:

```ts
interface Config {
  browser?: string;
  repos: string[];
}
```

Exported functions:

- `findConfigPath(configPath?: string): string | null` -- returns the first existing config path from candidates, or null. When an explicit `configPath` is given, only that path is checked.
- `loadConfig(configPath?: string): Result<Config, ConfigNotFoundError | ConfigParseError>` -- finds the config file, reads and parses it, validates that `repos` is a `string[]` and `browser` (if present) is a string.
- `saveBrowserToConfig(browser: string, configPath?: string): Result<string, ConfigParseError>` -- reads an existing config (or creates a new one with empty `repos`), sets the `browser` field, writes back. Returns the path to the written file.
- `validateRepos(repos: string[]): { valid: string[]; missing: string[]; notGit: string[] }` -- partitions repo paths into three buckets: existing directories with `.git`, directories that don't exist, and directories that exist but lack `.git`.

Imported by: `index.ts`.

---

## src/workspaces.ts (272 lines)

Monorepo workspace detection and glob resolution. Checks `pnpm-workspace.yaml` first, then `package.json` workspaces fields (both array and `{ packages: [...] }` forms). Resolves glob patterns to concrete directory paths without shelling out to a glob library.

Exported types:

```ts
interface WorkspacePackage {
  name: string;
  path: string;
  relativePath: string;
}

interface WorkspaceConfig {
  isWorkspace: boolean;
  packages: WorkspacePackage[];
}
```

Exported functions:

- `resolveWorkspaceGlobs(repoPath: string, globs: string[]): string[]` -- resolves workspace glob patterns to directory paths. Handles trailing wildcards (`**`), inline wildcards, and negation patterns (prefixed with `!`). De-duplicates results.
- `getWorkspacePackages(repoPath: string, dirs: string[]): WorkspacePackage[]` -- reads `package.json` from each directory, extracts the `name` field (falls back to directory basename), returns sorted by name.
- `detectWorkspaces(repoPath: string): WorkspaceConfig` -- gets workspace globs, resolves them to directories, collects workspace packages. Returns `{ isWorkspace: false, packages: [] }` if no globs or no packages are found.

Non-exported internals:

- `TRAILING_WILDCARD_RE` -- regex stripping `/**` or `/*` suffixes
- `parsePnpmWorkspaceYaml(repoPath: string): string[] | null` -- reads `pnpm-workspace.yaml`, extracts the `packages` array via the `yaml` library
- `getWorkspaceGlobs(repoPath: string): string[] | null` -- checks pnpm workspace yaml, then `package.json` workspaces (array or object form)
- `listChildDirs(parentDir: string): string[]` -- lists immediate child directories using `readdirSync`/`statSync`
- `listDirsRecursive(parentDir: string): string[]` -- recursively lists all descendant directories
- `resolveGlob(repoPath: string, glob: string): string[]` -- resolves a single glob pattern to directory paths

Imported by: `runner.ts` (detectWorkspaces, WorkspaceConfig type), `changesets.ts` (WorkspacePackage type only).

---

## src/changesets.ts (278 lines)

Changeset file management for dependency updates. Snapshots dependency versions before and after package manager runs, diffs the results, and writes `.changeset/*.md` files. Supports both single-package and workspace-aware (monorepo) changeset generation.

Exported types:

```ts
interface DepSnapshot {
  [pkg: string]: string;
}

interface DepChange {
  from: string;
  name: string;
  to: string;
}
```

Exported functions:

- `hasChangesets(repoPath: string): boolean` -- checks for `.changeset/config.json` or `@changesets/cli` in devDependencies.
- `snapshotDeps(repoPath: string): DepSnapshot` -- reads `package.json` and returns the `dependencies` object as a flat map.
- `diffDeps(before: DepSnapshot, after: DepSnapshot): DepChange[]` -- compares two snapshots, returns sorted array of changes. Empty strings for `from`/`to` represent added or removed dependencies.
- `getChangesetFiles(repoPath: string): string[]` -- lists `.changeset/*.md` files, excluding `README.md`.
- `getPackageName(repoPath: string): string` -- reads the `name` field from `package.json`, returns `"unknown"` if absent.
- `writeChangesetFile(repoPath: string, packageName: string, changes: DepChange[], timestamp: number): void` -- writes `.changeset/dep-updates-{timestamp}.md` with a `"packageName": patch` frontmatter header and bullet list of version changes.
- `snapshotWorkspaceDeps(repoPath: string, packages: WorkspacePackage[]): Map<string, DepSnapshot>` -- snapshots deps for the root package and all workspace packages into a keyed map. Warns on duplicate names.
- `diffWorkspaceDeps(before: Map<string, DepSnapshot>, after: Map<string, DepSnapshot>): Map<string, DepChange[]>` -- diffs two workspace snapshot maps, returning only packages that have changes.
- `writeWorkspaceChangesetFile(repoPath: string, changedPackages: Map<string, DepChange[]>, timestamp: number): void` -- writes a multi-package changeset with per-package frontmatter and grouped bullet lists.

Non-exported internals:

- `DEPENDENCY_ARROW` -- string constant `"->"` used in changeset diff lines

Imported by: `runner.ts` (all exports except DepSnapshot type).

---

## src/runner.ts (818 lines)

Core repository update workflow. Handles package manager detection, dependency updates, git branch management, PR creation via `gh`, changeset generation, and workspace-aware updates. This is the largest file in `src/`.

Exported types:

```ts
type PackageManager = "npm" | "pnpm" | "yarn" | "bun"

interface ExecOutput {
  stderr: string;
  stdout: string;
}

interface RepoResult {
  prUrl?: string;
  repo: string;
  status: "pr-created" | "no-changes";
}
```

Exported functions:

- `detectPackageManager(repoPath: string): PackageManager` -- checks for lockfiles in priority order: `bun.lock`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`. Falls back to `"npm"`.
- `getUpdateCommand(pm: PackageManager, minor?: boolean): string[]` -- returns the command array for updating root dependencies. Minor mode uses native `npm update`/`pnpm update`/etc.; latest mode uses `npx npm-check-updates --upgrade` (npm, yarn) or native `--latest` flags (pnpm, bun).
- `getInstallCommand(pm: PackageManager): string[]` -- returns the install command for the given package manager.
- `getWorkspaceUpdateCommand(pm: PackageManager, minor?: boolean): string[]` -- returns the workspace-aware update command. npm and yarn fall back to `npx npm-check-updates --workspaces` since they lack native latest+workspace flags.
- `execBun(cmd: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }>` -- executes a command using `Bun.spawn` with piped stdout/stderr.
- `execNodejs(cmd: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }>` -- executes a command using `node:child_process.spawn` as a runtime fallback.
- `exec(cmd: string[], cwd: string): Promise<Result<ExecOutput, CommandFailedError>>` -- runtime-switching wrapper that calls `execBun` or `execNodejs` based on `typeof Bun`, wraps non-zero exits as `CommandFailedError`.
- `updateRepo(options, execFn?): Promise<Result<RepoResult, CommandFailedError | InvalidInputError>>` -- the main workflow function. Validates the date, creates a timestamped branch from the default branch, runs the update and install commands, generates changesets if applicable, commits and pushes changes, creates a PR via `gh pr create`. Cleans up the branch on any failure.

Non-exported internals:

- `DEFAULT_BRANCH_REGEX` -- matches `refs/remotes/origin/(branch)` from `git symbolic-ref`
- `DATE_FORMAT_REGEX` -- matches `YYYY-MM-DD` strings
- `isValidCalendarDate(date: string): boolean` -- validates a date string is a real calendar date by constructing a `Date` and checking UTC fields
- `ExecError` class -- wraps failed process output with `stdout`, `stderr`, and `exitCode`
- `CleanupOptions` interface -- parameters for branch cleanup on failure
- `performCleanup(options: CleanupOptions): Promise<void>` -- hard-resets the worktree, checks out the default branch, deletes local and remote branches, removes any written changeset file
- `ChangesetContext` interface -- state needed for changeset generation during a repo update
- `handleChangesets(ctx: ChangesetContext): string | undefined` -- decides whether to write a changeset, delegates to single-package or workspace-specific logic, returns the written file path or undefined
- `prepareWorkspaceContext(repo, pm, minor, noWorkspaces)` -- detects workspaces, snapshots pre-update deps, selects the right update command
- `DryRunOptions` interface -- parameters for dry-run simulation
- `dryRunRepo(options: DryRunOptions): Result<RepoResult, CommandFailedError>` -- prints the steps that `updateRepo` would execute without making changes

Imported by: `index.ts` (execBun, execNodejs, updateRepo).

---

## src/index.ts (713 lines)

Main orchestrator. Resolves repos from CLI args or config, processes each one for dependency updates, and opens created PR URLs in the system browser. Contains the cross-platform browser detection subsystem, which accounts for roughly 300 lines.

Exported types:

```ts
type ExecFn = (
  cmd: string[],
  cwd: string
) => Promise<{ stdout: string; stderr: string; exitCode: number }>
```

Exported functions:

- `printUsage(): void` -- prints CLI help text with flags, descriptions, and examples.
- `resolveRepos(args: ParsedArgs): { repos: string[]; config?: Config } | null` -- uses positional args if provided, otherwise loads from config. Returns null (with an error message) if no config is found and no positional args are given.
- `processRepo(repo, date, dryRun, updateFn?, minor?, noChangeset?, noWorkspaces?): Promise<{ repo, status, prUrl? }>` -- processes a single repo with `@clack/prompts` spinners. Delegates to `updateRepo` (or a custom `updateFn`).
- `openURLBun(cmd: string[]): void` -- fire-and-forget URL open using `Bun.spawn`.
- `openURLBunSync(cmd: string[]): number | null` -- synchronous URL open using `Bun.spawnSync`.
- `openURLNodejs(cmd: string[]): Promise<void>` -- detached URL open using `node:child_process.spawn` with `child.unref()`.
- `detectBrowser(platform?, execFn?): Promise<{ browser: string; path?: string } | null>` -- cross-platform default browser detection. Dispatches to `detectMacosBrowser`, `detectWindowsBrowser`, or `detectLinuxBrowser` based on `process.platform`.
- `openURLs(urls, platform?, execFn?, browserOverride?): Promise<void>` -- opens one or more URLs in the system browser. Detects the browser, builds platform-specific open commands, and executes them.
- `main(argv?, updateFn?): Promise<void>` -- top-level entry point. Parses args, loads config, validates repos, processes each repo, and offers to open PR URLs.

Non-exported internals:

- `RepoProcessingOptions` interface -- aggregation of parameters for batch repo processing
- `handleRepoProcessing(options: RepoProcessingOptions): Promise<void>` -- iterates repos and collects PR URLs
- `handlePRDisplay(prUrls: string[]): Promise<boolean | undefined>` -- shows PR URLs in a clack note, asks whether to open them
- `escapeForAppleScript(s: string): string` -- escapes backslashes and double quotes for `osascript` string interpolation
- `buildOpenCommands(urls, platform, browserInfo): string[][]` -- constructs platform-specific command arrays for opening URLs (macOS `open`/`osascript`, Windows `start`/direct exe, Linux `xdg-open`/direct command)
- `detectMacosBrowser(execFn): Promise<{ browser: string } | null>` -- reads `LSHandlers` from macOS defaults, checks for Firefox's bundle identifier
- `getWindowsDefaultBrowserPath(execFn): Promise<string | null>` -- uses PowerShell to resolve the full exe path from the Windows registry
- `detectWindowsBrowser(execFn): Promise<{ browser: string; path?: string } | null>` -- queries the Windows registry for HTTP handler prog IDs, resolves to executable paths, falls back to a hardcoded prog ID map
- `detectLinuxBrowser(execFn): Promise<{ browser: string } | null>` -- queries `xdg-settings get default-web-browser`, maps `.desktop` file names to commands
- Regex constants: `PROG_ID_REGEX`, `DESKTOP_SUFFIX_REGEX`, `MACOS_FIREFOX_REGEX`, `REG_COMMAND_REGEX`, `EXE_SUFFIX_REGEX`
- Lookup maps: `windowsProgIdMap` (ChromeHTML/MSEdgeHTM/BraveHTML to exe names), `linuxDesktopMap` (desktop file names to commands)

Imported by: `cli.ts`, `deno-cli.ts`.

---

## src/cli.ts (21 lines)

Bun and Node entry point. A thin wrapper with a shebang line and an error boundary.

```ts
#!/usr/bin/env node
```

Calls `main()` and catches any rejected promise. On error, logs the message and stack trace, then calls `process.exit(1)`.

No exports. Imports `main` from `./index.ts`.

---

## src/deno-cli.ts (31 lines)

Deno entry point. Mirrors `cli.ts` but uses a Deno-specific shebang and ambient type declaration instead of `@types/deno` (to keep the Bun/Node type-check pass clean).

```ts
#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net
```

Declares a minimal `Deno` ambient type with just `args: string[]` and `exit(code?): never`. Calls `main(Deno.args)`, catches errors, and calls `Deno.exit(1)`.

No exports. Imports `main` from `./index.ts`.

---

## Import graph

```
cli.ts, deno-cli.ts
  -> index.ts
       -> args.ts
       -> config.ts
            -> errors.ts
       -> runner.ts
            -> errors.ts
            -> changesets.ts
                 -> package-json.ts
                 -> workspaces.ts (type only)
            -> workspaces.ts
```

`errors.ts` and `package-json.ts` are leaf modules with no source imports. `workspaces.ts` depends only on `package-json.ts`. `changesets.ts` depends on `package-json.ts` and the `WorkspacePackage` type from `workspaces.ts`. `runner.ts` depends on `errors.ts`, `changesets.ts`, and `workspaces.ts`. `config.ts` depends on `errors.ts`. `index.ts` depends on `args.ts`, `config.ts`, and `runner.ts`. The two CLI entry points depend only on `index.ts`.
