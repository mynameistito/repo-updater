# CI/CD pipelines

## CI gate (`ci.yml`)

Runs on push and pull request to `main`. Four jobs form a dependency chain: everything depends on `check`, and `build`, `test-bun`, and `test-node` run in parallel once it passes.

**check (typecheck and lint)** is the gatekeeper. It runs `bun run typecheck` (which invokes `tsgo --noEmit`) followed by `bun run check` (Ultracite lint and format verification). All three downstream jobs list it under `needs`.

**build** runs `bun run build` (tsdown) and then `npm pack --dry-run` to inspect the tarball contents without publishing anything. This catches export map mismatches or missing files in the distributed package.

**test-bun** uses a matrix strategy with two versions: `latest` and `canary`. Canary failures do not block the pipeline because `continue-on-error` is set conditionally to `true` when `matrix.bun-version == 'canary'`. Both variants run the full test suite (all 7 test files) via `bun test`.

**test-node** tests against Node 22.x and 24.x. It runs `bun run test:node`, which invokes Vitest. That command skips `cli.test.ts` because that file uses `mock.module()` which is Bun-specific. So only 6 test files run under Node.

Concurrency is keyed to `${{ github.workflow }}-${{ github.ref }}`. PRs cancel in-progress runs (the usual "latest push wins" behavior), but pushes to main never cancel each other.

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

## Release pipeline (`release.yml`)

This workflow does not trigger on push events. It uses `workflow_run` to react when the CI pipeline completes successfully on `main`:

```yaml
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
```

The job only runs when `github.event.workflow_run.conclusion == 'success'`. Permissions are scoped up from the usual read-only baseline: `contents: write` (for version commits), `pull-requests: write` (for release PRs), and `id-token: write` (for OIDC token generation during npm publish).

The checkout step pins to the exact commit that CI validated, not whatever is currently on `main`:

```yaml
- uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
  with:
    fetch-depth: 0
    ref: ${{ github.event.workflow_run.head_sha }}
```

This is important. Because `workflow_run` triggers in the base repo context (similar to `pull_request_target`), checking out `head_sha` ensures the release builds the exact code CI approved, not whatever a malicious PR might have injected.

Node setup pins `npm@11.12.0` globally. That version is required for OIDC Trusted Publishing support. The publish environment variable `NPM_CONFIG_PROVENANCE: true` tells npm to attach provenance metadata to the published package.

The changesets action handles two paths. If changeset files exist, it opens or updates a version PR (running `bun run version`). If the version PR was just merged and no changeset files remain, it publishes to npm (running `bunx changeset publish`) and creates GitHub releases. After npm publish succeeds, JSR publish runs via `npx jsr publish --allow-slow-types`, gated on `steps.changesets.outputs.published == 'true'`.

Concurrency uses the CI run's head SHA as the group key and never cancels in-progress runs. That prevents duplicate releases for the same commit while allowing consecutive merges to queue up.

## Supporting workflows

### CodeQL (`codeql.yml`)

Triggers on push and PR to `main`, plus a weekly cron (`23 7 * * 1`, Mondays at 07:23 UTC). Analyzes JavaScript and TypeScript using the `security-extended` query suite. Concurrency cancels in-progress PR runs.

### Preview builds (`pkg-pr-new.yml`)

Triggers on push to `main` and all PRs (not branch-filtered). Builds the package and publishes a preview to pkg.pr.new. The `--comment=create` flag posts installable links directly on the PR. Permissions are scoped to `contents: read` and `pull-requests: write`.

### PR triage (`pr-triage.yml`)

Uses `pull_request_target` on `opened`, `reopened`, and `ready_for_review` events. The workflow checks out the base branch (not the PR branch), parses `.github/CODEOWNERS` for the default owner, and requests a review if no reviewers or teams are assigned. Draft PRs are skipped entirely. If the CODEOWNER is the PR author, the review request is skipped to avoid self-review.

### Issue triage (`issue-triage.yml`)

Runs when an issue is opened. Adds a `triage` label if the issue has no labels yet, and assigns the default CODEOWNER from `.github/CODEOWNERS`.

### PR labels (`pr-labels.yml`)

Uses `pull_request_target` on `opened`, `synchronize`, and `reopened` events. Applies labels based on changed files according to `.github/labeler.yml`. Nine categories exist: `dependencies`, `ci`, `github-config`, `source`, `tests`, `documentation`, `configuration`, `scripts`, and `changeset`. The `sync-labels: true` option means stale labels are removed when their matching files are no longer changed.

### Stale bot (`stale.yml`)

Runs on a weekly cron (`30 8 * * 1`, Mondays at 08:30 UTC). Issues become stale after 60 days and close 14 days later. PRs become stale after 30 days and close 7 days later. Labels `pinned`, `security`, and `bug` exempt items from being marked stale. Any activity (comment, push, label change) removes the stale label. Closed items get a `wontfix` label.

## Security practices

Every GitHub Action across all workflows is pinned to a full commit SHA rather than a tag. Tags are mutable and can be reassigned; SHAs cannot. For example, `actions/checkout` is pinned as `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6` rather than `actions/checkout@v6`.

Most workflows request only `contents: read`. The CI gate, CodeQL, preview builds, and triage workflows all follow this pattern. Only the workflows that need elevated access (release, stale bot, PR triage, PR labels) request additional permissions, and only the specific ones they require.

The release workflow's use of `workflow_run` could be a security concern because it runs with write permissions in the base repo context. The mitigation is checking out at the exact CI head SHA rather than the default ref. This means the release builds only the code that passed CI, not an arbitrary branch a contributor might control.

`NPM_CONFIG_PROVENANCE: true` during npm publish generates a signing certificate and transparency log entry linking the published package back to the GitHub Actions run that produced it. Combined with `id-token: write`, this enables npm's OIDC Trusted Publishing feature, which eliminates the need for long-lived npm tokens stored as repository secrets.

Concurrency groups appear in most workflows to prevent race conditions. CI and release each key their concurrency group differently: CI uses the branch ref (cancelling superseded PR runs), while release uses the CI run's head SHA (preventing duplicate publishes of the same commit).
