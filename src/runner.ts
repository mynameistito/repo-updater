/**
 * @module runner
 *
 * Core repository update workflow. Handles package manager detection,
 * dependency updates, Git branch management, PR creation, changeset
 * generation, and workspace-aware updates across multiple repositories.
 */
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Result } from "better-result";
import type { DepSnapshot } from "./changesets.ts";
import {
  diffDeps,
  diffWorkspaceDeps,
  getChangesetFiles,
  getPackageName,
  hasChangesets,
  snapshotDeps,
  snapshotWorkspaceDeps,
  writeChangesetFile,
  writeWorkspaceChangesetFile,
} from "./changesets.ts";
import { CommandFailedError, InvalidInputError } from "./errors.ts";
import type { WorkspaceConfig } from "./workspaces.ts";
import { detectWorkspaces } from "./workspaces.ts";

/** Matches the default branch line from `git symbolic-ref` output. */
const DEFAULT_BRANCH_REGEX = /refs\/remotes\/origin\/(.+)$/;
/** Matches a calendar date in `YYYY-MM-DD` format. */
const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates that a string conforms to `YYYY-MM-DD` calendar date format.
 *
 * @param date - The date string to validate.
 * @returns `true` if the date is valid.
 */
function isValidCalendarDate(date: string): boolean {
  if (!DATE_FORMAT_REGEX.test(date)) {
    return false;
  }
  const [year, month, day] = date.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/**
 * Supported package managers for dependency updates.
 *
 * Detection priority (checked via lockfile presence): `bun` → `pnpm` → `yarn` → `npm`.
 */
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/**
 * Detects the package manager used by a repository by checking for lockfiles.
 *
 * Checks in priority order: `bun.lock` → `pnpm-lock.yaml` → `yarn.lock` →
 * `package-lock.json`. Falls back to `"npm"` if no lockfile is found.
 *
 * @param repoPath - Absolute path to the repository root.
 * @returns The detected {@link PackageManager}.
 */
export function detectPackageManager(repoPath: string): PackageManager {
  // Check in priority order (most specific lock files first)
  const checks: Array<{ file: string; pm: PackageManager }> = [
    { file: "bun.lock", pm: "bun" },
    { file: "pnpm-lock.yaml", pm: "pnpm" },
    { file: "yarn.lock", pm: "yarn" },
    { file: "package-lock.json", pm: "npm" },
  ];

  for (const { file, pm } of checks) {
    if (existsSync(join(repoPath, file))) {
      return pm;
    }
  }
  return "npm"; // fallback
}

/**
 * Returns the CLI command array to update root dependencies.
 *
 * @param pm - The detected {@link PackageManager}.
 * @param minor - When `true`, restricts updates to the current minor range.
 * @returns The command tokens to pass to {@link exec}.
 */
export function getUpdateCommand(pm: PackageManager, minor = false): string[] {
  if (minor) {
    const commands: Record<PackageManager, string[]> = {
      npm: ["npm", "update"],
      pnpm: ["pnpm", "update"],
      yarn: ["yarn", "upgrade"],
      bun: ["bun", "update"],
    };
    return commands[pm];
  }
  const commands: Record<PackageManager, string[]> = {
    npm: ["npx", "--yes", "npm-check-updates", "--upgrade"],
    pnpm: ["pnpm", "update", "--latest"],
    yarn: ["yarn", "upgrade", "--latest"],
    bun: ["bun", "update", "--latest"],
  };
  return commands[pm];
}

/**
 * Returns the CLI command array to install dependencies after an update.
 *
 * @param pm - The detected {@link PackageManager}.
 * @returns The command tokens to pass to {@link exec}.
 */
export function getInstallCommand(pm: PackageManager): string[] {
  const commands: Record<PackageManager, string[]> = {
    npm: ["npm", "install"],
    pnpm: ["pnpm", "install"],
    yarn: ["yarn", "install"],
    bun: ["bun", "install"],
  };
  return commands[pm];
}

/**
 * Returns the CLI command array to update workspace dependencies.
 *
 * For `npm` and `yarn`, uses `npx npm-check-updates --workspaces` because
 * neither package manager has a built-in `--latest` flag for workspace-wide
 * updates. `pnpm` and `bun` have native recursive/latest update support.
 *
 * @param pm - The detected {@link PackageManager}.
 * @param minor - When `true`, restricts updates to the current minor range.
 * @returns The command tokens to pass to `exec`.
 */
export function getWorkspaceUpdateCommand(
  pm: PackageManager,
  minor = false
): string[] {
  if (minor) {
    const commands: Record<PackageManager, string[]> = {
      npm: ["npm", "update", "--workspaces"],
      pnpm: ["pnpm", "update", "-r"],
      yarn: [
        "npx",
        "--yes",
        "npm-check-updates",
        "--upgrade",
        "--target",
        "minor",
        "--workspaces",
      ],
      bun: ["bun", "update"], // bun update already handles workspaces natively
    };
    return commands[pm];
  }
  const commands: Record<PackageManager, string[]> = {
    npm: ["npx", "--yes", "npm-check-updates", "--upgrade", "--workspaces"],
    pnpm: ["pnpm", "update", "--latest", "-r"],
    yarn: ["npx", "--yes", "npm-check-updates", "--upgrade", "--workspaces"],
    bun: ["bun", "update", "--latest"], // bun update already handles workspaces natively
  };
  return commands[pm];
}

/**
 * Captures the output of a spawned child process.
 *
 * @property stdout - Standard output captured as a string.
 * @property stderr - Standard error captured as a string.
 */
export interface ExecOutput {
  stderr: string;
  stdout: string;
}

/**
 * Describes the result of processing a single repository.
 *
 * @property repo - The repository path that was processed.
 * @property prUrl - The URL of the created pull request, if applicable.
 * @property status - Whether a PR was created or no changes were detected.
 */
export interface RepoResult {
  prUrl?: string;
  repo: string;
  status: "pr-created" | "no-changes";
}

/**
 * Internal error wrapping a failed child process execution.
 *
 * @property message - Human-readable error description including the exit code.
 * @property stdout - Captured standard output.
 * @property stderr - Captured standard error output.
 * @property exitCode - The process exit code.
 */
class ExecError extends Error {
  stdout: string;
  stderr: string;
  exitCode: number;

  constructor(stdout: string, stderr: string, exitCode: number) {
    super(`Process exited with code ${exitCode}`);
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

/**
 * Executes a command using Bun's native `Bun.spawn` with synchronous output capture.
 *
 * @param cmd - The command and arguments to execute.
 * @param cwd - The working directory for the command.
 * @returns The captured {@link ExecOutput} with exit code.
 */
export async function execBun(
  cmd: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

/**
 * Executes a command using Node.js `child_process.spawn` as a fallback
 * when running outside the Bun runtime.
 *
 * @param cmd - The command and arguments to execute.
 * @param cwd - The working directory for the command.
 * @returns The captured {@link ExecOutput} with exit code.
 */
export async function execNodejs(
  cmd: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { spawn } = await import("node:child_process");

  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  const childProcess = spawn(cmd[0], cmd.slice(1), {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  await new Promise<void>((resolve, reject) => {
    childProcess.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    childProcess.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    childProcess.on("close", (code) => {
      exitCode = code ?? 0;
      resolve();
    });

    childProcess.on("error", (err) => {
      reject(err);
    });
  });

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

/**
 * Executes a command, automatically selecting Bun or Node.js based on the
 * current runtime.
 *
 * @param cmd - The command and arguments to execute.
 * @param cwd - The working directory for the command.
 * @returns `Ok` with the captured {@link ExecOutput}, or `Err` with a
 *   {@link CommandFailedError} if the process exits non-zero.
 */
export function exec(
  cmd: string[],
  cwd: string
): Promise<Result<ExecOutput, CommandFailedError>> {
  return Result.tryPromise({
    try: async () => {
      // Use Bun's spawn if available, fallback to child_process
      const result =
        typeof Bun === "undefined"
          ? await execNodejs(cmd, cwd)
          : await execBun(cmd, cwd);

      if (result.exitCode !== 0) {
        throw new ExecError(result.stdout, result.stderr, result.exitCode);
      }

      return { stdout: result.stdout, stderr: result.stderr };
    },
    catch: (e) => {
      const info = e instanceof ExecError ? e : null;
      return new CommandFailedError({
        message: `Command failed: ${cmd.join(" ")} (exit ${info?.exitCode ?? "unknown"})`,
        command: cmd.join(" "),
        stderr: info?.stderr ?? String(e),
      });
    },
  });
}

/**
 * Options required for branch cleanup after a failed update.
 *
 * @property repo - Repository filesystem path.
 * @property branch - The branch name to delete.
 * @property branchCreated - Whether the branch was created locally.
 * @property branchPushed - Whether the branch was pushed to the remote.
 * @property changesetFile - Path to a changeset file to remove, if any.
 * @property defaultBranch - The repository's default branch to reset to.
 * @property execFn - Command executor function.
 */
interface CleanupOptions {
  branch: string;
  branchCreated: boolean;
  branchPushed: boolean;
  changesetFile?: string;
  defaultBranch: string;
  execFn: (
    cmd: string[],
    cwd: string
  ) => Promise<Result<ExecOutput, CommandFailedError>>;
  repo: string;
}

/**
 * Removes a failed update branch and resets the working directory to the
 * default branch.
 *
 * @param options - The {@link CleanupOptions} specifying repo, branch, and executor.
 */
async function performCleanup({
  defaultBranch,
  branch,
  branchCreated,
  branchPushed,
  execFn,
  repo,
  changesetFile,
}: CleanupOptions): Promise<void> {
  if (!branchCreated) {
    return;
  }

  if (changesetFile && existsSync(changesetFile)) {
    try {
      unlinkSync(changesetFile);
    } catch {
      console.warn(
        `Cleanup: Could not remove changeset file: ${changesetFile}`
      );
    }
  }

  // Hard-reset index + worktree to HEAD so the branch switch doesn't fail.
  // `git checkout -- .` only restores the worktree from the index, which is
  // insufficient when `git add -A` has already staged changes.
  const resetResult = await execFn(["git", "reset", "--hard", "HEAD"], repo);
  if (resetResult.isErr()) {
    console.warn(
      `Cleanup: Failed to reset worktree: ${resetResult.error.message}`
    );
  }

  const checkoutResult = await execFn(["git", "checkout", defaultBranch], repo);
  if (checkoutResult.isErr()) {
    console.warn(
      `Cleanup: Failed to checkout ${defaultBranch}: ${checkoutResult.error.message}`
    );
  }

  if (branchPushed) {
    const deleteRemoteResult = await execFn(
      ["git", "push", "origin", "--delete", branch],
      repo
    );
    if (deleteRemoteResult.isErr()) {
      console.warn(
        `Cleanup: Could not delete remote branch ${branch}: ${deleteRemoteResult.error.message}`
      );
    }
  }

  const deleteResult = await execFn(["git", "branch", "-D", branch], repo);
  if (deleteResult.isErr()) {
    console.warn(
      `Cleanup: Failed to delete branch ${branch}: ${deleteResult.error.message}`
    );
  }
}

/**
 * Aggregates the state needed for changeset generation during a repo update.
 *
 * @property repo - Repository filesystem path.
 * @property isWorkspace - Whether the repo uses workspace packages.
 * @property noChangeset - Whether changeset generation was disabled.
 * @property depsBefore - Pre-update workspace dependency snapshot, or `null` for single-package repos.
 * @property singleDepsBefore - Pre-update root dependency snapshot, or `null` for workspace repos.
 * @property timestamp - Unix timestamp used in the changeset filename.
 * @property workspace - The detected {@link WorkspaceConfig}.
 */
interface ChangesetContext {
  depsBefore: Map<string, DepSnapshot> | null;
  isWorkspace: boolean;
  noChangeset: boolean;
  repo: string;
  singleDepsBefore: DepSnapshot | null;
  timestamp: number;
  workspace: WorkspaceConfig;
}

/**
 * Creates and writes a changeset file when dependency updates are detected.
 *
 * Checks {@link hasChangesets} and {@link getChangesetFiles} to determine
 * whether the repo uses changesets and whether a target file already exists.
 * In workspace mode, snapshots with {@link snapshotWorkspaceDeps}, diffs with
 * {@link diffWorkspaceDeps}, and writes via {@link writeWorkspaceChangesetFile}.
 * For single-package repos, uses {@link snapshotDeps}, {@link diffDeps}, and
 * {@link writeChangesetFile}.
 *
 * @param ctx - The {@link ChangesetContext} describing the repo, snapshot state,
 *   and workspace configuration.
 * @returns The absolute path to the written changeset file, or `undefined` when
 *   no changeset is needed (changesets disabled, no dependency changes, or the
 *   target file already exists).
 */
function handleChangesets(ctx: ChangesetContext): string | undefined {
  if (ctx.noChangeset || !hasChangesets(ctx.repo)) {
    return undefined;
  }

  const targetFile = `dep-updates-${ctx.timestamp}.md`;
  if (getChangesetFiles(ctx.repo).includes(targetFile)) {
    return undefined;
  }

  const filePath = join(ctx.repo, ".changeset", targetFile);

  if (ctx.isWorkspace && ctx.depsBefore) {
    const depsAfter = snapshotWorkspaceDeps(ctx.repo, ctx.workspace.packages);
    const changes = diffWorkspaceDeps(ctx.depsBefore, depsAfter);
    if (changes.size === 0) {
      return undefined;
    }
    writeWorkspaceChangesetFile(ctx.repo, changes, ctx.timestamp);
  } else if (ctx.singleDepsBefore) {
    const depsAfter = snapshotDeps(ctx.repo);
    const changes = diffDeps(ctx.singleDepsBefore, depsAfter);
    const pkgName = getPackageName(ctx.repo);
    if (changes.length === 0 || pkgName === "unknown") {
      return undefined;
    }
    writeChangesetFile(ctx.repo, pkgName, changes, ctx.timestamp);
  } else {
    return undefined;
  }

  console.log(
    `[info] Wrote changeset: .changeset/dep-updates-${ctx.timestamp}.md`
  );
  return filePath;
}

/**
 * Determines whether workspace-aware changeset handling should be used and
 * prepares the necessary context.
 *
 * @param repo - Repository path.
 * @param pm - Detected package manager.
 * @param minor - Whether minor-only updates are requested.
 * @param noWorkspaces - Whether workspace detection was disabled by the user.
 * @returns An object containing workspace configuration, update command, and
 *   pre-update dependency snapshots.
 */
function prepareWorkspaceContext(
  repo: string,
  pm: PackageManager,
  minor: boolean,
  noWorkspaces: boolean
) {
  const workspace = noWorkspaces
    ? { isWorkspace: false, packages: [] }
    : detectWorkspaces(repo);
  const isWorkspace = workspace.isWorkspace;

  if (isWorkspace) {
    console.log(
      `[info] Detected monorepo with ${workspace.packages.length} workspace packages`
    );
  }

  const depsBefore = isWorkspace
    ? snapshotWorkspaceDeps(repo, workspace.packages)
    : null;
  const singleDepsBefore = isWorkspace ? null : snapshotDeps(repo);
  const updateCmd = isWorkspace
    ? getWorkspaceUpdateCommand(pm, minor)
    : getUpdateCommand(pm, minor);

  return { workspace, isWorkspace, depsBefore, singleDepsBefore, updateCmd };
}

/**
 * Performs a full dependency update cycle on a single repository.
 *
 * Clones the target branch from the default branch, runs the package manager
 * update command, installs dependencies, commits changes, pushes, and creates
 * a pull request via `gh pr create`. Supports changeset generation and
 * workspace-aware updates when enabled.
 *
 * @param options - Repository path, date, flags, and optional overrides.
 * @param options.repo - Repository filesystem path.
 * @param options.date - Date string in `YYYY-MM-DD` format (used in branch name and PR title).
 * @param options.dryRun - When `true`, prints the steps without executing them.
 * @param options.minor - When `true`, restricts updates to the current minor range.
 * @param options.noChangeset - When `true`, skips changeset file generation.
 * @param options.noWorkspaces - When `true`, disables workspace detection.
 * @param execFn - Optional command executor (defaults to {@link exec}).
 *   Useful for testing or custom runtime environments.
 * @returns `Ok` with the {@link RepoResult}, or `Err` with a
 *   {@link CommandFailedError} if any step fails. On failure the branch
 *   is cleaned up automatically.
 *
 * @example
 * ```ts
 * const result = await updateRepo({
 *   repo: "./my-repo",
 *   date: "2026-03-30",
 *   dryRun: false,
 *   minor: true,
 * });
 * if (result.isOk()) console.log("PR:", result.value.prUrl);
 * ```
 */
export function updateRepo(
  options: {
    repo: string;
    date: string;
    dryRun: boolean;
    minor?: boolean;
    noChangeset?: boolean;
    noWorkspaces?: boolean;
  },
  execFn = exec
): Promise<Result<RepoResult, CommandFailedError | InvalidInputError>> {
  const {
    repo,
    date,
    dryRun,
    minor = false,
    noChangeset = false,
    noWorkspaces = false,
  } = options;

  if (!isValidCalendarDate(date)) {
    return Promise.resolve(
      Result.err(
        new InvalidInputError({
          message: `Invalid date: "${date}" — expected a valid YYYY-MM-DD calendar date`,
        })
      )
    );
  }

  // Add timestamp to branch name to avoid collisions when running multiple times in one day
  const timestamp = Date.now();
  const branch = `chore/dep-updates-${date}-${timestamp}`;

  if (dryRun) {
    return Promise.resolve(
      dryRunRepo({
        repo,
        date,
        branch,
        minor,
        timestamp,
        noChangeset,
        noWorkspaces,
      })
    );
  }

  return Result.gen(async function* () {
    // Detect package manager
    const pm = detectPackageManager(repo);
    console.log(`[info] Detected package manager: ${pm}`);

    // Detect default branch dynamically
    let defaultBranch = "main";
    const defaultBranchResult = yield* Result.await(
      execFn(["git", "symbolic-ref", "refs/remotes/origin/HEAD"], repo)
    );
    const defaultBranchMatch =
      defaultBranchResult.stdout.match(DEFAULT_BRANCH_REGEX);
    if (defaultBranchMatch) {
      defaultBranch = defaultBranchMatch[1];
    }

    console.log(`[info] Using default branch: ${defaultBranch}`);

    let branchCreated = false;
    let branchPushed = false;
    let changesetFilePath: string | undefined;
    let succeeded = false;
    try {
      yield* Result.await(execFn(["git", "checkout", defaultBranch], repo));
      yield* Result.await(execFn(["git", "pull"], repo));
      yield* Result.await(execFn(["git", "checkout", "-b", branch], repo));
      branchCreated = true;

      // Auto-detect workspaces unless opted out
      const {
        workspace,
        isWorkspace,
        depsBefore,
        singleDepsBefore,
        updateCmd,
      } = prepareWorkspaceContext(repo, pm, minor, noWorkspaces);
      yield* Result.await(execFn(updateCmd, repo));
      yield* Result.await(execFn(getInstallCommand(pm), repo));

      // Snapshot deps after update, diff, and optionally write changeset
      try {
        changesetFilePath = handleChangesets({
          repo,
          timestamp,
          noChangeset,
          isWorkspace,
          workspace,
          depsBefore,
          singleDepsBefore,
        });
      } catch (e) {
        const command = isWorkspace
          ? "writeWorkspaceChangesetFile"
          : "writeChangesetFile";
        throw new CommandFailedError({
          message: `Failed to ${command}: ${String(e)}`,
          command,
          stderr: String(e),
        });
      }

      const status = yield* Result.await(
        execFn(["git", "status", "--porcelain"], repo)
      );

      if (status.stdout === "") {
        yield* Result.await(execFn(["git", "checkout", defaultBranch], repo));
        yield* Result.await(execFn(["git", "branch", "-D", branch], repo));
        succeeded = true;
        return Result.ok({
          repo,
          status: "no-changes" as const,
        });
      }

      yield* Result.await(execFn(["git", "add", "-A"], repo));
      yield* Result.await(
        execFn(["git", "commit", "-m", `dep updates ${date}`], repo)
      );
      yield* Result.await(
        execFn(["git", "push", "-u", "origin", branch], repo)
      );
      branchPushed = true;

      const pr = yield* Result.await(
        execFn(
          [
            "gh",
            "pr",
            "create",
            "--title",
            `Dep Updates ${date}`,
            "--body",
            `Dep Updates ${date}`,
          ],
          repo
        )
      );

      succeeded = true;
      return Result.ok({
        repo,
        status: "pr-created" as const,
        prUrl: pr.stdout,
      });
    } finally {
      if (!succeeded) {
        await performCleanup({
          defaultBranch,
          branch,
          branchCreated,
          branchPushed,
          execFn,
          repo,
          changesetFile: changesetFilePath,
        });
      }
    }
  });
}

/**
 * Options for performing a dry-run dependency update.
 *
 * @property repo - Repository filesystem path.
 * @property date - Date string for the branch name and PR title.
 * @property branch - Pre-computed branch name.
 * @property defaultBranch - Assumed default branch (actual detected at runtime).
 * @property minor - Whether minor-only updates are requested.
 * @property noChangeset - Whether changeset generation was disabled.
 * @property noWorkspaces - Whether workspace detection was disabled.
 * @property timestamp - Unix timestamp for the changeset filename.
 */
interface DryRunOptions {
  branch: string;
  date: string;
  defaultBranch?: string;
  minor?: boolean;
  noChangeset?: boolean;
  noWorkspaces?: boolean;
  repo: string;
  timestamp?: number;
}

/**
 * Simulates a dependency update without modifying the repository.
 *
 * @param options - The {@link DryRunOptions} for the dry run.
 * @returns Always `Ok` with a synthetic {@link RepoResult} listing what
 *   would change.
 */
function dryRunRepo({
  repo,
  date,
  branch,
  defaultBranch = "main",
  minor = false,
  timestamp = Date.now(),
  noChangeset = false,
  noWorkspaces = false,
}: DryRunOptions): Result<RepoResult, CommandFailedError> {
  const pm = detectPackageManager(repo);
  const workspace = noWorkspaces
    ? { isWorkspace: false, packages: [] }
    : detectWorkspaces(repo);

  console.log(
    `  [dry-run] assuming default branch: ${defaultBranch} (actual branch will be detected at runtime)`
  );
  console.log(`  [dry-run] detected package manager: ${pm}`);

  if (workspace.isWorkspace) {
    console.log(
      `  [dry-run] detected monorepo with ${workspace.packages.length} workspace packages`
    );
    for (const pkg of workspace.packages) {
      console.log(`  [dry-run]   - ${pkg.name} (${pkg.relativePath})`);
    }
  }

  const updateCmd = workspace.isWorkspace
    ? getWorkspaceUpdateCommand(pm, minor).join(" ")
    : getUpdateCommand(pm, minor).join(" ");

  const steps = [
    `git checkout ${defaultBranch}`,
    "git pull",
    `git checkout -b ${branch}`,
    updateCmd,
    getInstallCommand(pm).join(" "),
  ];

  if (!noChangeset && hasChangesets(repo)) {
    steps.push(
      `write .changeset/dep-updates-${timestamp}.md (only if deps changed)`
    );
  }

  steps.push(
    "git status --porcelain",
    "git add -A",
    `git commit -m "dep updates ${date}"`,
    `git push -u origin ${branch}`,
    `gh pr create --title "Dep Updates ${date}" --body "Dep Updates ${date}"`
  );

  for (const step of steps) {
    console.log(`  [dry-run] ${step}`);
  }

  return Result.ok({
    repo,
    status: "pr-created" as const,
    prUrl: "https://github.com/example/repo/pull/0",
  });
}
