# repo-updater

## 0.7.4

### Patch Changes

- da9ac79: Updated dependencies:
  - @clack/prompts: ^1.2.0 → ^1.3.0
  - better-result: ^2.8.2 → ^2.9.0
- 47893fb: Updated dependencies:
  - better-result: ^2.9.0 → ^2.9.1
  - yaml: ^2.8.3 → ^2.8.4

## 0.7.3

### Patch Changes

- e78dd94: Add ENOENT guard and actionable diagnostic when Node.js re-exec fails on Windows. Emit a clear stderr message suggesting `npm i -g repo-updater` or installing Node.js when `node` is not found on PATH. Handle null exit code from signal-killed processes. Add inline comment in `openURLs` explaining why all URL-open commands route through `openURLNodejs` unconditionally to prevent UAC prompts under Bun on Windows.

## 0.7.2

### Patch Changes

- 4fb3e5f: Updated dependencies:
  - better-result: ^2.7.0 → ^2.8.1
- 4d8b923: Updated dependencies:
  - better-result: ^2.8.1 → ^2.8.2

## 0.7.1

### Patch Changes

- 8bbc816: Updated dependencies:
  - @clack/prompts: ^1.1.0 → ^1.2.0

## 0.7.0

### Minor Changes

- 52da3c0: Add tsdown build pipeline with compiled JS output and `.d.ts` type declarations. Replace raw TS publishing with built `dist/` artifacts for npm consumers while Deno continues to use raw `src/` files. Add consistent `exports` and `bin` fields to both `package.json` and `deno.json`.

## 0.6.1

### Patch Changes

- a67b10e: Add `bin` field to `deno.json` so `deno install -g` creates a proper executable shim for the CLI.

## 0.6.0

### Minor Changes

- cf42893: Add Deno runtime compatibility for global install. Merge `jsr.json` into `deno.json` with `npm:` import maps, add `./cli` export for the CLI entrypoint, and update shebang for cross-runtime support. A lefthook pre-commit hook auto-syncs `package.json` dependencies into `deno.json` imports.

## 0.5.2

### Patch Changes

- b4cf2e6: Add JSDoc module documentation to all source and test files. Add `.changeset/AGENTS.md` and `.changeset/CLAUDE.md` knowledge base files. Fix `openURLNodejs` to detach the spawned browser process so the CLI can exit independently.

## 0.5.1

### Patch Changes

- 894f303: Add explicit type annotations to `TaggedError` exports to resolve JSR slow type warnings.

## 0.5.0

### Minor Changes

- 9bd5743: Add `--browser` flag and open PR URLs in a new browser window

  - Open PR URLs in a new browser window instead of reusing an existing one
  - Add `--browser` flag to override default browser detection
  - Persist browser choice to config file
  - Support cross-platform browser launching (Windows, macOS, Linux)

### Patch Changes

- 15dc792: added ignore for assets folder
- 14fc0e1: Add `scripts/sync-jsr-version.ts` to auto-sync package.json version into jsr.json after `changeset version`. Guard against missing version field. Wire the sync script into the `version` npm script.

## 0.4.1

### Patch Changes

- 48497c0: cve bumps
- 246b264: added to jsr, testing jsr release

## 0.4.0

### Minor Changes

- 93c0e8d: Add monorepo/workspace support and changeset control flags

  - Auto-detect workspace configuration from pnpm-workspace.yaml or package.json workspaces field
  - Update all workspace packages using correct package manager commands (pnpm update -r, npm update --workspaces, ncu --workspaces for Yarn)
  - Add --no-workspaces flag to skip workspace detection and update root only
  - Add --no-changeset flag to skip automatic changeset creation
  - Generate multi-package changesets listing all changed workspace packages
  - Fix `**` glob patterns to recursively match nested directories
  - Fix negation patterns (e.g., `!packages/internal`) to work correctly as post-resolution exclusions
  - Fix duplicate workspace entries from overlapping or repeated globs
  - Warn instead of silently overwriting when duplicate package names are detected
  - Parse pnpm-workspace.yaml with `yaml` library to support all YAML formats (flow-style, multiline, etc.)

## 0.3.2

### Patch Changes

- Fix release workflow and harden CI

  - Fix npm OIDC Trusted Publishing: remove `registry-url` injection, upgrade npm for OIDC support
  - Pin release checkout to `workflow_run.head_sha` for deterministic releases
  - Use commit SHA in concurrency keys to prevent injection risk
  - Add concurrency block to CI to deduplicate runs on rapid pushes
  - Gate release workflow on CI success via `workflow_run`
  - Remove redundant `npm pack --dry-run` from `prepublishOnly`
  - Delete redundant `.npmignore` (superseded by `files` allowlist)

## 0.3.1

### Patch Changes

- 9352b06: Add build and pack scripts for local build verification and CI

  - Add `build` script using `bun build` to compile `src/cli.ts` to `dist`
  - Add `build:pack` script for creating distributable tarballs
  - Add `prepublishOnly` gate that runs build, typecheck, tests, and pack dry-run before publish
  - Add Build Verification job to CI workflow (with explicit bun-version)
  - Ignore `*.tgz` files in `.gitignore`

## 0.3.0

### Minor Changes

- cff5d72: Auto-write a Changesets file on dep-update PRs for repos that use Changesets.

  - Detects Changesets via `.changeset/config.json` or `@changesets/cli` in `devDependencies`
  - Snapshots `dependencies` before and after the update, then writes a `patch` changeset if anything changed
  - Skips writing if the target changeset file already exists (idempotent across retries)
  - Automatically cleans up the changeset file on failure during branch rollback
  - Dry-run mode previews the changeset step without writing anything

## 0.2.3

### Patch Changes

- 84badc1: Fix CodeQL security alerts and add calendar-aware date validation

  - Restrict CI workflow permissions to `contents: read` to address CodeQL permission alert
  - Add `isValidCalendarDate` helper that rejects semantically invalid dates (e.g. `2024-02-30`) even when they match `YYYY-MM-DD` format
  - Introduce `InvalidInputError` for structured input validation errors
  - Guard `stderr` access in `processRepo` with an `"in"` check to safely handle the wider `CommandFailedError | InvalidInputError` union type

## 0.2.2

### Patch Changes

- 3405209: bump dep

## 0.2.1

### Patch Changes

- cfec48d: bump dep

## 0.2.0

### Minor Changes

- 08fc860: Add `--minor` / `-m` flag to restrict dependency updates to minor and patch versions. Also updates the default npm command to use `npx --yes npm-check-updates --upgrade` to support major-version upgrades, consistent with `pnpm update --latest`, `yarn upgrade --latest`, and `bun update --latest`.

## 0.1.10

### Patch Changes

- 7728a5c: - Bump Dep's
  - ↑ @typescript/native-preview 7.0.0-dev.20260314.1 → 7.0.0-dev.20260317.1
  - ↑ ultracite 7.3.1 → 7.3.2
  - ↑ vitest 3.2.4 → 4.1.0

## 0.1.9

### Patch Changes

- 961f62d: - Add shebang to `src/cli.ts` so the CLI runs correctly on macOS and Linux when installed globally via `bun install -g`.
  - Bump Dependencies
    - ↑ @biomejs/biome 2.4.6 → 2.4.7
    - ↑ @typescript/native-preview 7.0.0-dev.20260311.1 → 7.0.0-dev.20260314.1
    - ↑ lefthook 2.1.3 → 2.1.4
    - ↑ ultracite 7.2.5 → 7.3.1
- 86429b3: dep bump

## 0.1.8

### Patch Changes

- 611d7bd: Bump dev dependencies (`@biomejs/biome`, `@typescript/native-preview`, `lefthook`, `ultracite`) and fix README inaccuracies: correct package manager detection order, update commands with `--latest` flags, swap pipeline step order to match code, and note that non-git directories are also skipped.

## 0.1.7

### Patch Changes

- dd9eba5: dep bump

## 0.1.6

### Patch Changes

- d0d4141: dep update

## 0.1.5

### Patch Changes

- 86f2981: dep bump and fix minimatch 8.7 CVE

## 0.1.4

### Patch Changes

- 2dd7ad8: Updated Dependencies:
  - @biomejs/biome 2.4.0 → 2.4.2
  - @typescript/native-preview 7.0.0-dev.20260215.1 → 7.0.0-dev.20260217.1
  - ultracite 7.2.2 → 7.2.3

## 0.1.3

### Patch Changes

- 8faef12: Fix package manager detection to prioritize bun.lock over package-lock.json.

  When a project has both bun.lock and package-lock.json, the detection now correctly identifies it as a bun project instead of npm.

## 0.1.2

### Patch Changes

- e03b824: Add Node.js setup with OIDC registry configuration for npm publishing.

  - Setup Node.js with registry-url for npmjs.org
  - Enable OIDC-based authentication without requiring NPM_TOKEN secret
  - Simplify npm credentials handling in GitHub Actions workflow

## 0.1.1

### Patch Changes

- b92aacf: Fix GitHub Actions release workflow to use GitHub OIDC for NPM publishing.

  - Configure npm registry with OIDC trusted publishing
  - Remove NPM_TOKEN secret dependency
  - Enable both GitHub and NPM package publishing in single workflow

## 0.1.0

### Minor Changes

- 18b86fa: Initial release of repo-updater CLI.

  - CLI tool to mass-update Bun dependencies across multiple git repositories
  - Automated pipeline: update deps, commit, push, and create PRs via GitHub CLI
  - Config file support with search in current directory and `~/.config/repo-updater/`
  - Dry-run mode (`-n`/`--dry-run`) to preview actions without making changes
  - Interactive terminal UI with spinners, colored output, and PR summary
  - Railway-oriented error handling with typed errors via `better-result`
  - Option to open all created PR URLs in the browser after completion
  - CI workflow for typecheck, lint, and tests across Bun versions
  - Release workflow with changesets for automated npm publishing

### Patch Changes

- 28b88e4: Fix linting and complexity issues in source code.

  - Fix empty block statements with proper comments
  - Remove nested ternary operators
  - Refactor complex async generator function to reduce cognitive complexity
  - Remove unnecessary try-catch clauses
  - Fix unused function parameters
