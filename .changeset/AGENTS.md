# .changeset

Contains changeset entries and configuration for `@changesets/cli`.

## File Convention

Each changeset file is a markdown file with YAML frontmatter:

```md
---
"package-name": patch|minor|major
---

Description of the change.
```

Files without this frontmatter (like this `AGENTS.md`) are ignored by the CLI.

## Naming Convention

Changeset filenames should be **three random words joined by hyphens** (e.g. `chore-fix-jsr-slow-types.md`, `velvet-moon-crane.md`, `solar-pine-otter.md`). Do not use literal descriptions of the change — pick three arbitrary words.

## Key Files

| File | Purpose |
|------|---------|
| `config.json` | Changeset configuration (access, changelog format, base branch) |
| `README.md` | Default changeset readme (created by `changeset init`) |
| `*.md` (with frontmatter) | Changeset entries consumed during `changeset version` |
