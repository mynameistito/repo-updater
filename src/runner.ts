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

const DEFAULT_BRANCH_REGEX = /refs\/remotes\/origin\/(.+)$/;
const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

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

export interface ExecOutput {
  stderr: string;
  stdout: string;
}

export interface RepoResult {
  prUrl?: string;
  repo: string;
  status: "pr-created" | "no-changes";
}

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
