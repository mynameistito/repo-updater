# Installation

## Prerequisites

Before installing repo-updater, make sure you have the following on your system.

**Git.** Any reasonably recent version works. You need it because the tool creates branches, commits, and pushes PRs in your repos.

**GitHub CLI.** Install `gh` and authenticate it by running `gh auth login`. The tool uses `gh pr create` to open pull requests, so it needs an authenticated session.

**A JavaScript runtime.** You need at least one of:

- Bun 1.0.0 or later
- Node 22.6.0 or later
- Deno (recent enough to support JSR imports)

## Install methods

Pick the section that matches your setup.

### npm (works with Node)

```bash
npm install -g repo-updater
```

The published package is compiled `.mjs` via tsdown, with the binary at `./dist/cli.mjs`.

### pnpm

```bash
pnpm add -g repo-updater
```

### yarn

```bash
yarn global add repo-updater
```

### Bun

Install globally:

```bash
bun add -g repo-updater
```

Or skip the install entirely and run straight from source:

```bash
bun run src/cli.ts
```

### Deno

```bash
deno install -g jsr:@mynameistito/repo-updater
```

The JSR package publishes raw TypeScript (no build step). The Deno entry point is `src/deno-cli.ts`, which uses a shebang with inline permissions.

### One-off runs (no install)

If you just want to run it once without adding it to your global packages:

```bash
npx repo-updater
```

or with Bun:

```bash
bunx repo-updater
```

## Verify installation

Run the help flag to confirm everything is wired up:

```bash
repo-updater --help
```

If you see the usage output, you are good to go.

## Running from source

If you prefer to work directly with the repository:

```bash
git clone https://github.com/mynameistito/repo-updater.git
cd repo-updater
bun install
bun run start
```

This uses Bun's built-in TypeScript support, so there is no separate build step needed for local development.
