# Quickstart

This guide walks you through your first run of repo-updater. You need `gh` (the GitHub CLI) installed and authenticated, since the tool creates PRs via `gh pr create`.

## Before your first run

Start with dry-run mode. Pass the `-n` flag and the tool will print every step it would take, including the exact git commands, package manager update commands, and PR creation call. Nothing touches your repos.

This is worth doing before any real run because it confirms that the tool can find your repos, detects the right package manager, and uses the branch name and PR title you expect. If something looks off, you catch it before any branches or commits exist.

## Running your first update

Point the tool at a single repo on disk:

```
repo-updater /path/to/your/repo
```

Here is what happens, step by step.

The tool starts with a banner from @clack/prompts, then validates that the path exists and is a git repository. Next it detects the package manager by checking for lockfiles in this order: `bun.lock`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`. If none are found it falls back to npm. It also queries the remote to find the default branch (via `git symbolic-ref refs/remotes/origin/HEAD`) rather than assuming `main`.

After that, it checks out the default branch, pulls latest, and creates a new branch named `chore/dep-updates-{YYYY-MM-DD}-{timestamp}`. The timestamp prevents collisions if you run the tool twice in one day. It runs the package manager's update command, installs the updated dependencies, checks whether a `.changeset` directory exists, and writes a changeset file if dependencies actually changed. Finally it commits, pushes, and opens a PR.

A successful run looks like this:

```
│
│  repo-updater
│
│  my-project
│  ◼ Updating dependencies...
│
│  [info] Detected package manager: pnpm
│  [info] Using default branch: main
│  [info] Wrote changeset: .changeset/dep-updates-1743340800000.md
│  Done: my-project
│  ✓ my-project: https://github.com/you/my-project/pull/42
│
│  Pull Requests
│  https://github.com/you/my-project/pull/42
│
│  ? Open all PR URLs in browser? (Y/n)
```

The PR title follows the pattern `Dep updates {YYYY-MM-DD}`. The body matches.

At the end, the tool prints all PR URLs and asks whether you want to open them in your browser. It auto-detects your default browser on macOS, Windows, and Linux. You can also set a specific browser with the `-b` flag.

## What "no changes" looks like

If all dependencies are already at their latest versions, the update command produces no file changes. The tool notices this when `git status --porcelain` comes back empty. It skips the commit, push, and PR steps entirely. No branch is left behind.

```
│  my-project
│  ◼ Updating dependencies...
│  No changes: my-project
│  ○ my-project: No dependency changes
```

This is normal. The tool moves on to the next repo, or prints "No pull requests were created." and exits.

## Updating multiple repos

Pass several paths at once:

```
repo-updater /path/to/repo-one /path/to/repo-two /path/to/repo-three
```

The tool processes each one in order. If a repo fails partway through (say, a merge conflict on `git pull`), the tool cleans up the branch it created for that repo and continues with the rest. Failed repos are reported at the end.

For more than a handful of repos, or to avoid typing paths every time, use a config file. See [configuration.md](configuration.md) for how to set that up.

## Dry-run mode

Pass `-n` to preview what the tool would do:

```
repo-updater -n /path/to/your/repo
```

The output lists every step. For example:

```
│
│  repo-updater
│
│  [dry-run] No commands will be executed.
│
│  my-project
│    [dry-run] assuming default branch: main (actual branch will be detected at runtime)
│    [dry-run] detected package manager: pnpm
│    [dry-run] git checkout main
│    [dry-run] git pull
│    [dry-run] git checkout -b chore/dep-updates-2026-03-30-1743340800000
│    [dry-run] pnpm update --latest
│    [dry-run] pnpm install
│    [dry-run] write .changeset/dep-updates-1743340800000.md (only if deps changed)
│    [dry-run] git status --porcelain
│    [dry-run] git add -A
│    [dry-run] git commit -m "dep updates 2026-03-30"
│    [dry-run] git push -u origin chore/dep-updates-2026-03-30-1743340800000
│    [dry-run] gh pr create --title "Dep Updates 2026-03-30" --body "Dep Updates 2026-03-30"
```

Notice the default branch line says "assuming." In dry-run mode the tool does not contact the remote, so it prints `main` as a guess. In a real run it detects the actual default branch.

This is useful for checking that the right package manager gets picked up, that workspace packages are detected in monorepos, and that the git commands look correct. Nothing is executed, so you can run it as many times as you want without side effects.

## Next steps

- [configuration.md](configuration.md) covers the config file format, browser settings, and repo lists.
- [advanced-usage.md](advanced-usage.md) covers workspaces, changesets, minor-only updates, and CI integration.
