# Advanced usage

This page covers scenarios beyond the basic update-and-PR workflow. For config details, see [configuration.md](configuration.md). For the full flag reference, see the main README.

## Workspaces and monorepos

repo-updater detects workspace configuration automatically. It checks for `pnpm-workspace.yaml` first, then the `workspaces` array in `package.json`, then the `workspaces.packages` field (used by Yarn classic). If any of these are present, the repo is treated as a monorepo.

In workspace mode, the tool runs update commands that cover every package in the workspace rather than just the root. The commands differ by package manager. With pnpm, it runs `pnpm update --latest -r`. With npm, it uses `npx npm-check-updates -u --workspaces && npm install`. With Yarn, it uses `npx npm-check-updates -u --workspaces && yarn install`. Bun handles workspace updates natively without a special flag.

If you want to skip workspace detection and update only root dependencies, pass `--no-workspaces`.

## Changesets

When a repo uses [Changesets](https://github.com/changesets/changesets) (it has either a `.changeset/config.json` file or `@changesets/cli` listed as a dev dependency), repo-updater will write a changeset file after updating dependencies.

The tool snapshots the dependency versions before and after the update, diffs them, and generates a `.changeset/dep-updates-{timestamp}.md` file with a `patch` bump type. A single-dep repo produces a file like this:

```yaml
---
"my-package": patch
---

Updated dependencies:
- dep: 1.2.3 → 1.4.0
```

In a workspace repo, the changeset covers every package that changed. The frontmatter lists all affected packages, and the body has per-package sections:

```yaml
---
"packages/core": patch
"packages/ui": patch
---

Updated dependencies:
**packages/core**:
- dep: 2.0.1 → 2.1.0

**packages/ui**:
- dep: 3.0.0 → 3.1.2
```

If the repo does not have changesets configured, this step is skipped with no warning. To skip it manually even when changesets are present, pass `--no-changeset`.

If the update fails partway through, the tool cleans up the branch and removes any changeset file it created, so the repo is never left in a dirty state.

## Conservative updates with --minor

By default, repo-updater uses `npm-check-updates --latest` (or the equivalent for the detected package manager). This jumps every dependency to the latest published version, major bumps included.

The `--minor` flag switches to the native update command for most package managers (`npm update`, `pnpm update`, etc.). These commands respect semver ranges in your `package.json`, so a dependency pinned to `^1.2.3` will only move within `>=1.2.3 <2.0.0`. Yarn workspaces are an exception: they use `npx npm-check-updates --upgrade --target minor --workspaces` since Yarn lacks a native minor-only workspace update flag.

Use the default mode when you want to stay current and are willing to handle breaking changes. Use `--minor` when stability matters more and you want updates without surprises. The flag applies to every repo in the run.

## Browser config

After creating a PR, repo-updater opens the PR URL in your browser. It detects the default browser differently on each platform: macOS reads LaunchServices defaults, Windows queries the registry, and Linux systems use `xdg-settings`.

To override the detected browser, pass `-b` followed by the browser name:

```bash
repo-updater -b firefox
```

The preference is saved to your config file and reused on subsequent runs.

## CI integration

You can run repo-updater in GitHub Actions or any CI system. Here is a minimal workflow:

```yaml
name: Update dependencies

on:
  schedule:
    - cron: "0 6 * * 1"

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2

      - name: Install repo-updater
        run: bun add -g repo-updater

      - name: Authenticate gh CLI
        run: echo "${{ secrets.GH_TOKEN }}" | gh auth login --with-token

      - name: Run repo-updater
        run: repo-updater --config repo-updater.config.json
        env:
          GH_TOKEN: ${{ secrets.GH_TOKEN }}
```

A few things to keep in mind for CI:

- The `gh` CLI must be authenticated with a token that has write access to each target repo. If the token lacks permission, branch pushes will fail.
- The runner needs the package managers your repos use (npm, pnpm, yarn, or Bun) installed. The example above uses Bun, which covers Bun and npm repos. Add setup steps for pnpm or Yarn if needed.
- Use a personal access token or a GitHub App installation token, not `GITHUB_TOKEN`, if the target repos are in a different repository than the workflow.

## Troubleshooting

**"gh" CLI not authenticated.** Run `gh auth login` and follow the prompts. If you are running in CI, pipe a token into the login command as shown in the CI integration section above.

**No changes detected.** This means every dependency in the repo is already at the version the update command would resolve to. The tool will skip the repo and move on. This is not an error.

**Permission denied on push.** Check that your git remote credentials have write access to the repository. If you use SSH, verify your key is added to your GitHub account. If you use HTTPS, make sure your token has the `repo` scope.

**Lockfile conflicts after update.** Run the package manager's install command in the repo to regenerate the lockfile. For example, `pnpm install` or `npm install`. If the conflict persists, delete the lockfile and run install again.

**Config not found.** repo-updater looks for `./repo-updater.config.json` first, then `~/.config/repo-updater/config.json`. For the full resolution order and supported fields, see [configuration.md](configuration.md).
