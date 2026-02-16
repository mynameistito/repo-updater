# repo-updater

CLI tool that mass-updates [Bun](https://bun.sh) dependencies across multiple git repositories, commits changes, creates pull requests via [`gh`](https://cli.github.com), and opens all resulting PR URLs in the browser.

Replaces manually running a dependency update workflow in each repo one-by-one.

## Prerequisites

- [Bun](https://bun.sh) (runtime)
- [Git](https://git-scm.com)
- [GitHub CLI (`gh`)](https://cli.github.com) -- authenticated via `gh auth login`

## Setup

```sh
bun install repo-updater -g
```

## Usage

```
repo-updater [options] [repo paths...]
```

### Options

| Flag | Description |
| --- | --- |
| `-h`, `--help` | Show help message |
| `-n`, `--dry-run` | Print every step without executing any commands |
| `-c`, `--config <path>` | Path to a custom config file |

### Positional arguments

Pass one or more absolute repo paths directly to override the config file:

```sh
repo-updater C:\path\to\repo1 C:\path\to\repo2
```

### Examples

```sh
# Update all repos listed in config
repo-updater

# Preview what would happen without touching anything
repo-updater --dry-run

# Use a different config file
repo-updater -c ./other-config.json

# Update a single repo directly
repo-updater C:\path\to\single-repo
```

## Config file

The tool searches for a config file in this order:

1. Explicit path via `-c` / `--config`
2. `./repo-updater.config.json` (current working directory)
3. `~/.config/repo-updater/config.json` (user home)

### Format

```json
{
  "repos": [
    "C:\\path\\to\\repo-one",
    "C:\\path\\to\\repo-two"
  ]
}
```

The `repos` array contains absolute paths to git repositories. Directories that don't exist are skipped with a warning.

## What it does

For each repository, the tool runs this pipeline sequentially:

| Step | Command |
| --- | --- |
| 1 | `git checkout main` |
| 2 | `git pull` |
| 3 | `git checkout -b chore/dep-updates-DD-MM-YYYY` |
| 4 | `bun update --latest` |
| 5 | `bun install` |
| 6 | `git status --porcelain` |
| 7 | `git add -A` |
| 8 | `git commit -m "dep updates DD-MM-YYYY"` |
| 9 | `git push -u origin chore/dep-updates-DD-MM-YYYY` |
| 10 | `gh pr create --title "Dep Updates DD-MM-YYYY" --body "Dep Updates DD-MM-YYYY"` |

If step 6 shows no changes, the branch is deleted and the repo is skipped (reported as "no changes").

After all repos are processed, a summary box lists every PR URL. You're then prompted to open them all in the browser.

### Dry-run mode

With `--dry-run`, each step is printed to the console prefixed with `[dry-run]` but nothing is executed. No git commands run, no branches are created, no PRs are opened.

## Project structure

```
repo-updater/
  src/
    index.ts        Entry point -- CLI arg parsing, orchestration, UI
    config.ts       Config file loading and repo path validation
    runner.ts       exec() wrapper and per-repo update pipeline
    errors.ts       Typed error classes (TaggedError)
  repo-updater.config.json
  package.json
  tsconfig.json
  biome.jsonc
```

### `src/errors.ts`

Typed error classes using [`better-result`](https://github.com/dmmulroy/better-result)'s `TaggedError` factory:

- `DirectoryNotFoundError` -- repo path doesn't exist on disk
- `CommandFailedError` -- a git/bun/gh command exited non-zero
- `ConfigNotFoundError` -- no config file found in any search location
- `ConfigParseError` -- config file is invalid JSON or missing the `repos` array

### `src/config.ts`

- `loadConfig(configPath?)` -- returns `Result<Config, ConfigNotFoundError | ConfigParseError>`
- `validateRepos(repos)` -- checks each path with `existsSync`, returns `{ valid, missing }`

### `src/runner.ts`

- `exec(cmd, cwd)` -- wraps `Bun.spawn`, returns `Result<{ stdout, stderr }, CommandFailedError>`
- `updateRepo({ repo, date, dryRun })` -- runs the 10-step pipeline using `Result.gen` for railway-oriented error handling

### `src/index.ts`

- Hand-rolled arg parser (no external dependency)
- Interactive UI via [`@clack/prompts`](https://github.com/bombshell-dev/clack) (intro, spinners, colored logs, summary note, confirmation prompt)
- Repos processed sequentially -- failures in one repo don't stop the rest

## Scripts

```sh
bun start           # Run the tool
bun run typecheck   # Type-check with tsc
bun run check       # Lint + format check (ultracite/biome)
bun run fix         # Auto-fix lint + format issues
```

## Dependencies

### Runtime

- [`@clack/prompts`](https://github.com/bombshell-dev/clack) -- terminal UI (spinners, logs, prompts)
- [`better-result`](https://github.com/dmmulroy/better-result) -- `Result` type, `TaggedError`, `Result.gen` for typed error handling without try/catch

### Dev

- [`@biomejs/biome`](https://biomejs.dev) -- linter and formatter
- [`ultracite`](https://github.com/haydenbleasel/ultracite) -- biome preset configuration
- [`@types/bun`](https://bun.sh) -- Bun type definitions
- [`@typescript/native-preview`](https://github.com/nicolo-ribaudo/tc39-proposal-type-annotations) -- TypeScript compiler
- [`@changesets/cli`](https://github.com/changesets/changesets) -- versioning
- [`lefthook`](https://github.com/evilmartians/lefthook) -- git hooks
