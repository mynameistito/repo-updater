# Build and release

The project builds with tsdown (not tsc) and publishes to two registries: npm and JSR. Versioning is handled by changesets.

## Build with tsdown

The build config lives in `tsdown.config.ts`:

```ts
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  platform: "node",
  target: "node22",
  outDir: "dist",
  exports: {
    customExports(pkg) {
      pkg["."] = {
        types: "./dist/index.d.mts",
        import: "./dist/index.mjs",
      };
      pkg["./cli"] = {
        types: "./dist/cli.d.mts",
        import: "./dist/cli.mjs",
      };
      return pkg;
    },
  },
  publint: true,
  deps: {
    neverBundle: ["@clack/prompts", "better-result", "yaml"],
  },
});
```

Two entry points: `src/index.ts` (the library) and `src/cli.ts` (the CLI binary). The build produces `.mjs` files with `.d.mts` type declarations in `dist/`. Only ESM is emitted, no CommonJS.

A few things worth noting:

- `publint: true` validates that the `exports` field in `package.json` is correct.
- `deps.neverBundle` lists three runtime dependencies (`@clack/prompts`, `better-result`, `yaml`) that stay as external imports rather than getting bundled into the output. This avoids duplication when consumers already have these installed.
- `customExports(pkg)` programmatically rewrites the `package.json` exports map at build time so it matches the actual output file paths. This means the exports you see in `package.json` after a build are generated, not hand-maintained.

Build command:

```bash
bun run build
```

## JSR version sync

The script at `scripts/sync-jsr-version.ts` keeps `deno.json` in sync with `package.json`. It reads the version from `package.json` and writes it to `deno.json`. It also reads `package.json` dependencies and generates `npm:` import map entries in `deno.json`, so Deno consumers can resolve the three runtime dependencies at install time.

This runs in two places:

- A lefthook pre-commit hook, but only when `package.json` has changed.
- As part of `bun run version` during the changeset versioning flow.

## npm publish

npm receives compiled `.mjs` files from tsdown. The `files` field in `package.json` is set to `["dist"]`, so only the `dist/` directory ships to the registry. The `bin` field points to `./dist/cli.mjs`.

Publishing runs through `changesets/action` in `.github/workflows/release.yml` with OIDC provenance enabled (`NPM_CONFIG_PROVENANCE: true`) and a pinned `npm@11.12.0`. The workflow triggers on a successful CI run against `main`.

## JSR publish

JSR receives raw TypeScript source files, not compiled output. The `deno.json` `publish.include` array is `["LICENSE", "README.md", "src/**/*.ts"]` with test files excluded via `publish.exclude`.

Publish command (runs in the release workflow after npm publish succeeds):

```bash
npx jsr publish --allow-slow-types
```

The `npm:` import map in `deno.json` handles the three runtime deps on the Deno side.

## npm vs JSR

| Aspect | npm | JSR |
|---|---|---|
| Published content | Compiled `.mjs` + `.d.mts` from tsdown | Raw `.ts` source files |
| Output directory | `dist/` | `src/` |
| Package name | `repo-updater` | `@mynameistito/repo-updater` |
| CLI entry | `dist/cli.mjs` | `src/deno-cli.ts` |
| Library entry | `dist/index.mjs` | `src/index.ts` |
| Dependencies | In `node_modules` | `npm:` import map in `deno.json` |

## Changeset versioning flow

The release process works in stages:

1. A developer creates a `.changeset/*.md` file describing the change and the semver bump type, then merges it to `main`.
2. CI runs and passes.
3. `release.yml` triggers (it watches for successful CI runs on `main`).
4. The changesets action runs `bun run version`, which does three things in sequence: `changeset version` (bumps the version in `package.json`, updates `CHANGELOG.md`, and removes the consumed changeset files), then `bun run sync:jsr` (syncs the new version to `deno.json`), then `bunx ultracite fix deno.json` (formats the file).
5. This creates a "Version Packages" PR. The action commits with the message `chore: version packages`.
6. Once that PR merges, CI passes again. The changesets action then publishes to npm. If publish succeeds, a separate step publishes to JSR.

## prepublishOnly

The `prepublishOnly` script in `package.json` runs `bun run build && bun run typecheck` before npm publish. This ensures the build artifacts are fresh and types check out before anything ships.
