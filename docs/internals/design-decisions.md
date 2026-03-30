Design decisions

This doc covers the reasoning behind specific technical choices in repo-updater.
Architecture, error handling, testing, build, and CI each have their own docs.

Three runtimes without build-time conditionals

The project targets Bun, Node, and Deno from a single TypeScript codebase. There are
no build-time conditionals, no `#ifdef` blocks, and no separate compiled outputs per
runtime. The mechanism is a runtime check: `typeof Bun === "undefined"` selects between
`Bun.spawn` and `child_process.spawn` at call sites.

Deno gets its own entry point, `deno-cli.ts`, but all the logic lives in the same
shared source files that Bun and Node use.

The alternatives were maintaining separate build targets (one per runtime) or using a
preprocessor to strip runtime-specific code paths. Separate builds mean duplicating
build configuration and keeping them in sync. A preprocessor adds a build-time step
that's easy to forget when making changes. The runtime check is a single branch in a
few functions. The overhead is negligible compared to the network and process spawning
that the tool already does.

The tradeoff is that the source has occasional `if (typeof Bun !== "undefined")`
blocks that look a bit noisy. But they're localized to `src/runner.ts` and the entry
points, and they're straightforward to read.

Result type over try/catch

Every function that can fail returns `Result<T, E>` from `better-result` instead of
throwing. Errors flow through the return channel, not the exception channel.

The `Result.gen()` helper with `yield*` gives you early-return semantics that feel like
linear code. You write:

```typescript
const config = yield* loadConfig(path);
const repos = yield* resolveRepos(config);
```

If `loadConfig` returns an error, execution stops there and the error propagates out.
No nesting, no `if (err) return err` after every call.

The alternative, try/catch, means catching `unknown` and narrowing the type manually.
You lose the compiler's help tracking what can actually go wrong. With Result, the
return type `Result<Config, ConfigNotFoundError | ConfigParseError>` tells you exactly
what failures to handle. The compiler will warn you if you add a new error variant and
forget to deal with it somewhere.

The downside is that Result has a learning curve and the `yield*` syntax inside
generators looks unusual if you haven't seen it before. But once you're familiar with
it, the code reads top-to-bottom without the nesting that try/catch chains create.

Dependency injection over module mocking

`updateRepo(opts, execFn?)` and `main(argv?, updateFn?)` accept optional function
parameters that override their default implementations. Tests pass mock functions
through these parameters instead of using `vi.mock()` or `mock.module()`.

The reason is practical: `mock.module()` only works in Bun's test runner. That's why
`cli.test.ts` is excluded from the Vitest test run. If the tool used module mocking
throughout, half the test suite would only pass in Bun. DI works identically in both
Bun and Vitest, so the same test files run under both runners.

There's a secondary benefit too. When something is injectable, it's visible in the
function signature. You can look at `updateRepo` and see that it accepts an `execFn`.
With module mocking, the dependency is hidden in the test file, nowhere in the
production code.

The cost is slightly more verbose function signatures. Each injectable dependency adds
a parameter with a default value. But the project only has a few injection points, so
it stays manageable.

tsdown over tsc

The build step uses tsdown, not the TypeScript compiler's own `tsc --build` or `esbuild`
directly.

tsdown handles bundling, ESM output, DTS generation, and `package.json` export map
rewriting in a single tool. Getting the same output with tsc would require esbuild for
bundling, a separate DTS plugin like `tsup` or `@microsoft/api-extractor`, and a custom
script to rewrite exports. That's three tools instead of one.

tsdown also integrates with publint, which validates the exports map against the
actual files on disk. Catching a broken export at build time is better than finding it
after publish.

The project doesn't use tsc for output at all. The `tsconfig.json` exists purely for
type checking with tsgo. TypeScript compiles nothing.

declare const Deno over @types/deno

The `deno-cli.ts` file declares `Deno` as an ambient type:

```typescript
declare const Deno: { args: string[]; exit(code?: number): never };
```

Instead of installing and importing `@types/deno`.

Importing `@types/deno` would add Deno types to the global scope for the entire
project. That would break the Bun and Node type-check pass under tsgo, because those
types reference Deno-specific APIs that don't exist in the other runtimes.

The ambient declaration covers only what `deno-cli.ts` actually uses: `Deno.args` for
reading CLI arguments and `Deno.exit()` for exiting. If the Deno entry point ever
needs more of the Deno API, the declaration gets extended at that point. Until then,
there's no reason to pull in the full type package.

neverBundle for three dependencies

`@clack/prompts`, `better-result`, and `yaml` are marked `neverBundle` in the tsdown
configuration. They remain as external imports in the compiled output instead of being
bundled into the dist files.

The reasoning is that anyone installing repo-updater as a dependency likely already
has their own versions of these packages, or will install them as peer dependencies.
Bundling them in would create duplicate copies. Two copies of `better-result` in the
same node_modules tree means separate module instances, which breaks identity checks
and can cause subtle bugs with singleton patterns.

Keeping them external follows the standard pattern for Node.js libraries. The tool
itself is small enough that there's no performance gain from bundling these
dependencies. The installed package size stays reasonable either way.

Sequential lefthook hooks

The pre-commit hooks run sequentially, not in parallel. The order is: ultracite lint
fix, YAML validation, typecheck, build artifact cleanup, and JSR version sync.

The ordering matters. Lint fix should run before typecheck because formatting changes
can shift line numbers and column positions, which would produce confusing type error
locations if typecheck ran first on the unfixed code. JSR sync should only run after
everything else passes, since it modifies `deno.json` and you don't want to commit a
partially-synced version.

Parallel hooks would be faster, but they can't guarantee ordering. A lint fix and a
typecheck running at the same time could race on the same files. Sequential execution
is slower but deterministic, and pre-commit hooks run on a small codebase so the wall
clock difference is under a second.

Branch naming with timestamp

Branches are named `chore/dep-updates-{YYYY-MM-DD}-{unix-timestamp}`.

The date prefix groups related runs together when you look at a branch list sorted
alphabetically. You can see at a glance that three branches from March 30th were all
dependency update runs.

The Unix timestamp suffix prevents collisions when the tool runs multiple times in one
day. Without it, a second run on March 30th would try to create a branch named
`chore/dep-updates-2026-03-30`, which already exists. Git would either error out or
check out the existing branch, neither of which is what you want.

The timestamp is ugly to look at, but branch names are ephemeral. They get deleted
after the PR merges. Readability matters less than uniqueness here.

tsgo over tsc for type checking

The project uses tsgo, the Go-native TypeScript compiler, for `bun run typecheck`.
Not `tsc --noEmit`.

tsgo produces the same strict checking results as tsc but runs faster, noticeably so
on larger codebases. The `tsconfig.json` is standard TypeScript configuration that
works with either tool. The project could switch back to tsc with no config changes.
But tsgo finishes the typecheck pass in a fraction of the time.

The project doesn't use tsc for compilation at all (that's tsdown's job), so tsc has
no role in the build pipeline. Type checking is the only place where a TypeScript
compiler runs, and tsgo is the better tool for that specific job.

Separate CLI entry points instead of one

There are two entry point files: `cli.ts` for Bun and Node, and `deno-cli.ts` for
Deno. They could theoretically be one file with runtime detection, but they aren't.

The reason is the shebang line. Bun and Node expect `#!/usr/bin/env node`. Deno needs
`#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env
--allow-net`. These are fundamentally different. You can't have two shebangs in one
file, and you can't detect which runtime will execute the file before the shebang is
already parsed.

Both files are thin wrappers. They parse CLI arguments and call `main()` from
`src/index.ts`. The actual logic is shared. The only difference is the shebang, the
argument parsing setup, and the Deno-specific type declaration. Splitting them is the
simplest way to handle incompatible shebang requirements without adding complexity to
the shared code.
