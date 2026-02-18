import { existsSync } from "node:fs";
import { join } from "node:path";
import { Result } from "better-result";
import { CommandFailedError } from "./errors.ts";

const DEFAULT_BRANCH_REGEX = /refs\/remotes\/origin\/(.+)$/;

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export function detectPackageManager(repoPath: string): PackageManager {
  // Check in priority order (npm first for audit)
  const checks: Array<{ file: string; pm: PackageManager }> = [
    { file: "package-lock.json", pm: "npm" },
    { file: "pnpm-lock.yaml", pm: "pnpm" },
    { file: "yarn.lock", pm: "yarn" },
    { file: "bun.lock", pm: "bun" },
  ];

  for (const { file, pm } of checks) {
    if (existsSync(join(repoPath, file))) {
      return pm;
    }
  }
  return "npm"; // fallback
}

export function getUpdateCommand(pm: PackageManager): string[] {
  const commands: Record<PackageManager, string[]> = {
    npm: ["npm", "update"],
    pnpm: ["pnpm", "update", "--latest"],
    yarn: ["yarn", "upgrade"],
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

export interface ExecOutput {
  stdout: string;
  stderr: string;
}

export interface RepoResult {
  repo: string;
  status: "pr-created" | "no-changes";
  prUrl?: string;
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
        typeof Bun !== "undefined"
          ? await execBun(cmd, cwd)
          : await execNodejs(cmd, cwd);

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

async function performCleanup(
  defaultBranch: string,
  branch: string,
  branchCreated: boolean,
  branchPushed: boolean,
  execFn: (
    cmd: string[],
    cwd: string
  ) => Promise<Result<ExecOutput, CommandFailedError>>,
  repo: string
): Promise<void> {
  if (!branchCreated) {
    return;
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

export function updateRepo(
  options: {
    repo: string;
    date: string;
    dryRun: boolean;
  },
  execFn = exec
): Promise<Result<RepoResult, CommandFailedError>> {
  const { repo, date, dryRun } = options;
  // Add timestamp to branch name to avoid collisions when running multiple times in one day
  const timestamp = Date.now();
  const branch = `chore/dep-updates-${date}-${timestamp}`;

  if (dryRun) {
    return Promise.resolve(dryRunRepo(repo, date, branch, "main"));
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
    try {
      yield* Result.await(execFn(["git", "checkout", defaultBranch], repo));
      yield* Result.await(execFn(["git", "pull"], repo));
      yield* Result.await(execFn(["git", "checkout", "-b", branch], repo));
      branchCreated = true;

      yield* Result.await(execFn(getUpdateCommand(pm), repo));
      yield* Result.await(execFn(getInstallCommand(pm), repo));

      const status = yield* Result.await(
        execFn(["git", "status", "--porcelain"], repo)
      );

      if (status.stdout === "") {
        yield* Result.await(execFn(["git", "checkout", defaultBranch], repo));
        yield* Result.await(execFn(["git", "branch", "-D", branch], repo));
        return Result.ok<RepoResult, CommandFailedError>({
          repo,
          status: "no-changes",
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

      return Result.ok<RepoResult, CommandFailedError>({
        repo,
        status: "pr-created",
        prUrl: pr.stdout.trim(),
      });
    } catch (e) {
      await performCleanup(
        defaultBranch,
        branch,
        branchCreated,
        branchPushed,
        execFn,
        repo
      );
      throw e;
    }
  });
}

function dryRunRepo(
  repo: string,
  date: string,
  branch: string,
  defaultBranch = "main"
): Result<RepoResult, CommandFailedError> {
  const pm = detectPackageManager(repo);
  console.log(
    `  [dry-run] assuming default branch: ${defaultBranch} (actual branch will be detected at runtime)`
  );
  console.log(`  [dry-run] detected package manager: ${pm}`);

  const steps = [
    `git checkout ${defaultBranch}`,
    "git pull",
    `git checkout -b ${branch}`,
    getUpdateCommand(pm).join(" "),
    getInstallCommand(pm).join(" "),
    "git status --porcelain",
    "git add -A",
    `git commit -m "dep updates ${date}"`,
    `git push -u origin ${branch}`,
    `gh pr create --title "Dep Updates ${date}" --body "Dep Updates ${date}"`,
  ];

  for (const step of steps) {
    console.log(`  [dry-run] ${step}`);
  }

  return Result.ok({
    repo,
    status: "pr-created" as const,
    prUrl: "https://github.com/example/repo/pull/0",
  });
}
