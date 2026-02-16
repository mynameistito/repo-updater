---
"repo-updater": minor
---

Initial release of repo-updater CLI.

- CLI tool to mass-update Bun dependencies across multiple git repositories
- Automated pipeline: update deps, commit, push, and create PRs via GitHub CLI
- Config file support with search in current directory and `~/.config/repo-updater/`
- Dry-run mode (`-n`/`--dry-run`) to preview actions without making changes
- Interactive terminal UI with spinners, colored output, and PR summary
- Railway-oriented error handling with typed errors via `better-result`
- Option to open all created PR URLs in the browser after completion
- CI workflow for typecheck, lint, and tests across Bun versions
- Release workflow with changesets for automated npm publishing
