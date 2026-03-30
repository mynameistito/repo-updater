# Contributing

Thanks for taking the time to contribute!

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.0.0 **or** Node.js ≥ 22.0.0
- [GitHub CLI](https://cli.github.com) (`gh`) — required to run the tool locally

## Setup

```sh
git clone https://github.com/mynameistito/repo-updater.git
cd repo-updater
bun install
```

Pre-commit hooks are managed by [Lefthook](https://github.com/evilmartians/lefthook) and run automatically on commit. They run sequentially:

- **Lint & format** (`ultracite fix`) — auto-fixes JS/TS/JSON/CSS files
- **YAML validation** (`v8r`) — validates `.yml`/`.yaml` files
- **Type check** (`tsgo --noEmit`) — TypeScript validation on changed `.ts` files
- **Cleanup script** — runs `scripts/cleanup.ts` on every commit
- **JSR sync** — runs `scripts/sync-jsr-version.ts` to keep `deno.json` version in sync

If a hook fails, fix the reported issue before re-committing. Do **not** use `--no-verify` to bypass hooks.

## Project Structure

```
src/
  cli.ts          # Shebang entry point — delegates to index.ts
  deno-cli.ts     # Deno-specific entry point
  index.ts        # Main orchestration (argument resolution, repo processing, URL opening)
  args.ts         # CLI argument parser
  config.ts       # Config file loading and repo validation
  runner.ts       # Package manager detection, git ops, PR creation
  changesets.ts   # Changeset snapshot, diff, and file generation
  workspaces.ts   # Workspace detection and package resolution
  package-json.ts # Utility for reading/parsing package.json
  errors.ts       # Tagged error types (ConfigNotFoundError, CommandFailedError, …)

__tests__/
  bun-test-compat.ts   # Vitest shim for bun:test API
  args.test.ts
  config.test.ts
  runner.test.ts
  changesets.test.ts
  workspaces.test.ts
  cli.test.ts          # Bun-only (uses mock.module — excluded from vitest)
  errors.test.ts

scripts/
  cleanup.ts           # Pre-commit cleanup hook
  sync-jsr-version.ts  # Syncs deno.json version with package.json

.github/workflows/
  ci.yml       # Typecheck → lint → test (Bun latest/canary, Node 22/24)
  release.yml  # Changesets-based npm publish
```

## Development

```sh
bun run build     # build with tsdown
bun test          # run full test suite with Bun
bun run test:node # run tests with Vitest/Node (excludes cli.test.ts)
bun run typecheck # type-check with tsgo
bun run check     # lint with Biome/Ultracite (report only)
bun run fix       # lint + auto-fix
```

> `cli.test.ts` uses `mock.module()` from `bun:test`, which has no Vitest equivalent. It is excluded from the `test:node` script automatically via `vitest.config.ts`.

### Dry-run mode

Before testing against real repos, use `--dry-run` (`-n`) to print every step without executing it:

```sh
bun run src/cli.ts --dry-run /path/to/some-repo
```

### Config file

The tool resolves config from (in order):

1. `--config <path>` flag
2. `./repo-updater.config.json` in the current directory
3. `~/.config/repo-updater/config.json`

See `config.json.example` for the expected shape.

## Coding Conventions

- **ESM only** — all files use `import`/`export`; no `require()`.
- **Result types** — use `better-result` tagged errors instead of thrown exceptions. Add new error tags to `src/errors.ts`.
- **No external runtime deps** unless strictly necessary. The only runtime dependencies are `@clack/prompts`, `better-result`, and `yaml`.
- **Formatting/linting** is enforced by Biome via Ultracite. Run `bun run fix` to auto-fix before committing.

## Testing

When adding a feature or fixing a bug, include tests in `__tests__/`. Follow the existing patterns:

- **Unit tests** (`args`, `config`, `errors`) — test pure functions directly.
- **Runner tests** (`runner.test.ts`) — pass mock `exec` functions to `updateRepo()` to avoid spawning real processes.
- **Integration tests** (`cli.test.ts`) — Bun-only; use `mock.module()` to mock `@clack/prompts` and internal modules.

Use temporary directories (via `fs.mkdtempSync`) when tests need real file-system access, and clean them up in `afterEach`.

Run both test targets before opening a PR:

```sh
bun test
bun run test:node
```

## Submitting a PR

**Every PR must be linked to an open issue.** If one doesn't exist yet, open it first and wait for a brief acknowledgement before investing time in an implementation. This keeps effort aligned and avoids duplicate or unwanted work.

1. Open or find the relevant issue.
2. Fork the repo and create a branch from `main`.
3. Make your changes and ensure tests pass.
4. Add a changeset describing your change:
   ```sh
   bunx changeset
   ```
   Choose the correct bump type:
   - `patch` — bug fixes, documentation, internal refactors with no behavior change
   - `minor` — new flags, new package manager support, backwards-compatible features
   - `major` — breaking changes to the CLI interface or config format
5. Open a pull request against `main` and reference the issue (`Closes #123`) in the PR description.

> PRs without a changeset will not be merged unless they are non-user-facing (e.g. CI config, internal refactors with no behavior change).

### PR checklist

- [ ] Linked to an open issue
- [ ] Tests added or updated
- [ ] `bun test` and `bun run test:node` both pass
- [ ] `bun run typecheck` passes
- [ ] Changeset added (if user-facing)
- [ ] PR description explains *what* and *why*, not just *what*

## AI-Assisted Contributions

AI-assisted contributions are welcome. However:

- **Do not paste raw AI output** into PR descriptions or issue reports.
- Descriptions must be **accurate, concise, and human-reviewed**.
- Sloppy or generic AI-generated descriptions will be sent back for revision.

## Commit Style

Use short, imperative commit messages (e.g. `fix: handle missing config file`). Prefix with a type: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`.

## CI

CI runs on every push and PR to `main`:

1. **check** — typecheck + lint
2. **test-bun** — `bun test` on Bun latest and canary (canary failures are non-blocking)
3. **test-node** — `vitest run` on Node 22 and 24

All three jobs must pass for a PR to be mergeable.

## Release Process

Releases are automated via [Changesets](https://github.com/changesets/changesets) and the `release.yml` workflow:

1. Merging changesets to `main` triggers a "Version Packages" PR.
2. Merging that PR publishes to npm with provenance and creates a GitHub release.

You do not need to manually version or publish anything.
