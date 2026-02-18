# repo-updater

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
