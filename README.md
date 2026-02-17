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

## What it does

For each repository, the tool runs this pipeline sequentially:

| Step | Command |
| --- | --- |
| 1 | Detect default branch via `git symbolic-ref refs/remotes/origin/HEAD` (fallback to `main`) |
| 2 | `git checkout <default-branch>` |
| 3 | `git pull` |
| 4 | `git checkout -b chore/dep-updates-YYYY-MM-DD` |
| 5 | `bun update --latest` |
| 6 | `bun install` |
| 7 | `git status --porcelain` |
| 8 | `git add -A` |
| 9 | `git commit -m "dep updates YYYY-MM-DD"` |
| 10 | `git push -u origin chore/dep-updates-YYYY-MM-DD` |
| 11 | `gh pr create --title "Dep Updates YYYY-MM-DD" --body "Dep Updates YYYY-MM-DD"` |

If step 6 shows no changes, the branch is deleted and the repo is skipped (reported as "no changes").

After all repos are processed, a summary box lists every PR URL. You're then prompted to open them all in the browser.

### Dry-run mode

With `--dry-run`, each step is printed to the console prefixed with `[dry-run]` but nothing is executed. No git commands run, no branches are created, no PRs are opened.
