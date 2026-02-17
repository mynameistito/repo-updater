# repo-updater

CLI tool that mass-updates dependencies across multiple git repositories using your preferred package manager ([npm](https://www.npmjs.com/), [pnpm](https://pnpm.io/), [yarn](https://yarnpkg.com/), or [Bun](https://bun.sh)). Automatically detects the package manager, commits changes, creates pull requests via [`gh`](https://cli.github.com), and opens all resulting PR URLs in the browser.

Replaces manually running a dependency update workflow in each repo one-by-one.

## Features

- **Auto-detection**: Automatically detects which package manager to use based on lockfiles
- **Multi-package manager support**: Works with npm, pnpm, yarn, and Bun
- **Batch processing**: Update dependencies in multiple repos in one command
- **GitHub integration**: Creates pull requests and opens them in your browser
- **Dry-run mode**: Preview changes without executing anything
- **Cross-platform**: Runs on Windows, macOS, and Linux

## Prerequisites

- [Bun](https://bun.sh) (runtime)
- [Git](https://git-scm.com)
- [GitHub CLI (`gh`)](https://cli.github.com) -- authenticated via `gh auth login`

## Setup

```sh
bun install repo-updater -g
```

## Usage

```text
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

## How it works

### Package Manager Detection

The tool automatically detects which package manager to use by checking for lockfiles in this priority order:

1. `package-lock.json` → npm
2. `pnpm-lock.yaml` → pnpm
3. `yarn.lock` → yarn
4. `bun.lock` → Bun
5. (fallback) → npm

This allows you to manage mono-repos or mixed package manager environments without configuration.

### Update Pipeline

For each repository, the tool runs this pipeline sequentially:

| Step | Command |
| --- | --- |
| 1 | Detect default branch via `git symbolic-ref refs/remotes/origin/HEAD` (fallback to `main`) |
| 2 | Detect package manager from lockfiles |
| 3 | `git checkout <default-branch>` |
| 4 | `git pull` |
| 5 | `git checkout -b chore/dep-updates-YYYY-MM-DD` |
| 6 | `<pm> update` (or `<pm> upgrade` for yarn) |
| 7 | `<pm> install` |
| 8 | `git status --porcelain` |
| 9 | `git add -A` |
| 10 | `git commit -m "dep updates YYYY-MM-DD"` |
| 11 | `git push -u origin chore/dep-updates-YYYY-MM-DD` |
| 12 | `gh pr create --title "Dep Updates YYYY-MM-DD" --body "Dep Updates YYYY-MM-DD"` |

If step 8 shows no changes, the branch is deleted and the repo is skipped (reported as "no changes").

After all repos are processed, a summary box lists every PR URL. You're then prompted to open them all in the browser.

### Dry-run mode

With `--dry-run`, each step is printed to the console prefixed with `[dry-run]` but nothing is executed. No git commands run, no branches are created, no PRs are opened.

## Example Scenarios

### Single mono-repo with multiple package managers
If your mono-repo has `packages/app` using npm and `packages/lib` using pnpm, repo-updater will detect and use the correct package manager for each automatically.

### Mixed environment
Manage repos using different package managers in a single batch operation:
```json
{
  "repos": [
    "/path/to/npm-project",
    "/path/to/pnpm-monorepo",
    "/path/to/yarn-workspace",
    "/path/to/bun-project"
  ]
}
```

repo-updater will detect each one and run the appropriate update commands.
