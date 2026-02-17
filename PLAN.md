# repo-updater CLI Tool

## Context

A CLI tool to mass-update bun dependencies across multiple git repositories, commit changes, create PRs via `gh`, and open all resulting PR URLs in the browser. Replaces manually running the `git dep-update` alias in each repo one-by-one. Repo list lives in a config file, not hardcoded.

## Project Structure

```text
E:\GitHub\Tools\repo-updater\
├── .gitignore
├── biome.jsonc            # extends ultracite/biome/core
├── package.json
├── tsconfig.json
├── repo-updater.config.json # repo list config file
└── src/
    ├── cli.ts             # Bootstrap entry point
    ├── index.ts           # Main orchestration logic
    ├── args.ts            # CLI argument parsing
    ├── config.ts          # Load/validate config file (repo list)
    ├── runner.ts          # exec() helper, per-repo update pipeline
    └── errors.ts          # TaggedError types using better-result
```

## Dependencies

**Runtime:**
- `@clack/prompts` — CLI UI (intro/outro, spinner per repo, log.success/error/warn, summary note)
- `better-result` — Result types for error handling (`Result.tryPromise`, `TaggedError`, no try/catch)

**Dev:**
- `@changesets/cli`
- `@types/bun`
- `@typescript/native-preview`
- `lefthook`
- `ultracite` (replaces raw biome.json — provides presets via `biome.jsonc`)

## Config File — `repo-updater.config.json`

```json
{
  "repos": [
    "E:\\GitHub\\mynameistito\\justfuckingusecloudflare",
    "E:\\GitHub\\mynameistito\\mynameistito-site",
    "E:\\GitHub\\KillzoneGaming\\kzg-discord-banner-changer",
    "E:\\GitHub\\KillzoneGaming\\kzg-discord-oidc-changer",
    "E:\\GitHub\\KillzoneGaming\\kzg-discord-servers-webhook",
    "E:\\GitHub\\KillzoneGaming\\kzg-discord-tracker-bot",
    "E:\\GitHub\\KillzoneGaming\\kzg-servers-connect",
    "E:\\GitHub\\KillzoneGaming\\kzg-staff-profile-picture-grabber",
    "E:\\GitHub\\KillzoneGaming\\kzg-surf-maps-discord-bot",
    "E:\\GitHub\\KillzoneGaming\\kzg-surf-spreadsheet-grabber",
    "E:\\GitHub\\KillzoneGaming\\kzg-vip-confirmation-email-worker",
    "E:\\GitHub\\KillzoneGaming\\kzg-workshop-map-puller"
  ]
}
```

## Implementation Details

### `src/errors.ts` — Error types

Uses `better-result`'s `TaggedError` for typed, discriminated errors:

- `DirectoryNotFoundError` — repo path doesn't exist
- `CommandFailedError` — git/bun/gh command returned non-zero exit
- `ConfigNotFoundError` — config file missing
- `ConfigParseError` — config file invalid JSON or missing `repos` array

### `src/config.ts` — Config loading

- `loadConfig(configPath?)` — searches for config file: explicit arg → `./repo-updater.config.json` → `~/.config/repo-updater/config.json`
- Returns `Result<Config, ConfigNotFoundError | ConfigParseError>` using `Result.try`
- `validateRepos(repos)` — checks each directory exists via `existsSync`, returns `{ valid: string[], missing: string[] }`

### `src/runner.ts` — Per-repo pipeline

`exec(cmd: string[], cwd: string)` helper wrapping `Bun.spawn`:
- Returns `Result<{ stdout, stderr }, CommandFailedError>` using `Result.tryPromise`
- On non-zero exit, returns `Err(new CommandFailedError(...))`

`updateRepo(options)` runs the pipeline for one repo using `Result.gen`:
1. Detect default branch via `git symbolic-ref refs/remotes/origin/HEAD` (fallback to `main`)
2. `git checkout <default-branch>`
3. `git pull`
4. `git checkout -b chore/dep-updates-YYYY-MM-DD`
5. `bun update --latest`
6. `bun install`
7. `git status --porcelain` — if empty output, return early with `{ status: 'no-changes' }`
8. `git add -A`
9. `git commit -m "dep updates YYYY-MM-DD"`
10. `git push -u origin chore/dep-updates-YYYY-MM-DD`
11. `gh pr create --title "Dep Updates YYYY-MM-DD" --body "Dep Updates YYYY-MM-DD"`
12. Parse PR URL from `gh` stdout

Returns `Result<RepoResult, CommandFailedError>` where `RepoResult = { repo, prUrl, status }`.

### `src/index.ts` — Entry point & orchestration

**CLI flags** (hand-rolled parser):
- `-h` / `--help` — print usage
- `-n` / `--dry-run` — print steps without executing
- `-c` / `--config <path>` — custom config file path
- Positional args — override config file repo list

**Main flow using `@clack/prompts`:**

1. `intro('repo-updater')` — session start
2. Load config → on error: `log.error()`, `outro()`, exit
3. Validate directories → `log.warn()` for missing ones
4. Compute date `DD-MM-YYYY` once
5. For each repo sequentially:
   - `log.step(repoName)` to show which repo
   - `spinner.start('Updating dependencies...')`
   - Run `updateRepo()` pipeline
   - On success: `spinner.stop()` + `log.success(prUrl)`
   - On no-changes: `spinner.stop()` + `log.info('No changes')`
   - On failure: `spinner.stop()` + `log.error(reason)`
6. `note(prUrlList, 'Pull Requests')` — summary box with all PR URLs
7. Prompt to open all PR URLs in browser via `cmd /c start <url>`
8. `outro('Done!')` — session end

### Dry-run mode

When `--dry-run` is passed, each step logs what it would do via `log.info('[dry-run] command')` without executing. No spinner needed in dry-run mode.

## Setup Steps

1. Create `package.json`, `tsconfig.json`, `.gitignore`
2. Run `bunx ultracite@latest init --linter biome --pm bun --quiet` to scaffold `biome.jsonc`
3. Create `repo-updater.config.json` with the repo list
4. Create `src/errors.ts`, `src/config.ts`, `src/runner.ts`, `src/index.ts`
5. `bun install` to generate lockfile

## Verification

1. `bun run typecheck` — no type errors
2. `npx ultracite check` — no lint/format errors
3. `bun run src/index.ts --dry-run` — prints all repos with dry-run steps, no commands executed
4. `bun run src/index.ts --help` — prints usage text
5. `bun run src/index.ts` — full run against real repos, verify PRs created and URLs opened
