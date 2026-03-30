# repo-updater docs

repo-updater is a CLI that updates dependencies across a bunch of git repos at once. You point it at your repos, it figures out which package manager each one uses (npm, pnpm, yarn, or Bun), runs the updates, and opens a PR. It handles the tedious parts of dependency maintenance so you don't have to.

Built with TypeScript and runs on Bun, Node, or Deno. One toolchain, three runtimes.

## Quick setup

```bash
git clone https://github.com/mynameistito/repo-updater.git
cd repo-updater
bun install
bun run start
```

Node and Deno work too. The compiled output runs on Node 22+, and the raw TypeScript publishes to JSR for Deno consumers.

## Development commands

| Command | What it does |
|---|---|
| `bun run typecheck` | Type-check with tsgo |
| `bun test` | Run tests (Bun runner) |
| `bun run test:node` | Run tests (Vitest/Node) |
| `bun run check` | Lint check (Ultracite) |
| `bun run fix` | Auto-fix lint issues |
| `bun run build` | Build dist/ with tsdown |
| `bun run start` | Run the CLI |

## Using repo-updater

- [Installation](guide/installation.md) -- prerequisites and install instructions for every runtime
- [Quickstart](guide/quickstart.md) -- first run walkthrough
- [Configuration](guide/configuration.md) -- config file format and resolution
- [Advanced usage](guide/advanced-usage.md) -- workspaces, changesets, CI, and real-world scenarios

## How it works

- [Architecture](internals/architecture.md) -- layered architecture and data flow
- [Source reference](internals/source-reference.md) -- file-by-file source map
- [Error handling](internals/error-handling.md) -- Result types and TaggedError
- [Testing](internals/testing.md) -- dual-runner testing and mock patterns
- [Build and release](internals/build-and-release.md) -- build pipeline and dual publishing
- [CI/CD](internals/ci-cd.md) -- workflow details and release automation
- [Design decisions](internals/design-decisions.md) -- architectural rationale

For the full usage reference, flags, and examples, see the main [README](../README.md).
