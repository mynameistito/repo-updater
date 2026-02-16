import { Result } from "better-result";
import { CommandFailedError } from "./errors.ts";

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

export function exec(
  cmd: string[],
  cwd: string
): Promise<Result<ExecOutput, CommandFailedError>> {
  return Result.tryPromise({
    try: async () => {
      const proc = Bun.spawn(cmd, {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        throw new ExecError(stdout, stderr, exitCode);
      }

      return { stdout: stdout.trim(), stderr: stderr.trim() };
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

export function updateRepo(
  options: {
    repo: string;
    date: string;
    dryRun: boolean;
  },
  execFn = exec
): Promise<Result<RepoResult, CommandFailedError>> {
  const { repo, date, dryRun } = options;
  const branch = `chore/dep-updates-${date}`;

  if (dryRun) {
    return Promise.resolve(dryRunRepo(repo, date, branch));
  }

  return Result.gen(async function* () {
    yield* Result.await(execFn(["git", "checkout", "main"], repo));
    yield* Result.await(execFn(["git", "pull"], repo));
    yield* Result.await(execFn(["git", "checkout", "-b", branch], repo));
    yield* Result.await(execFn(["bun", "update", "--latest"], repo));
    yield* Result.await(execFn(["bun", "install"], repo));

    const status = yield* Result.await(
      execFn(["git", "status", "--porcelain"], repo)
    );

    if (status.stdout === "") {
      yield* Result.await(execFn(["git", "checkout", "main"], repo));
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
    yield* Result.await(execFn(["git", "push", "-u", "origin", branch], repo));

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

    const prUrl = pr.stdout.trim();

    return Result.ok<RepoResult, CommandFailedError>({
      repo,
      status: "pr-created",
      prUrl,
    });
  });
}

function dryRunRepo(
  repo: string,
  date: string,
  branch: string
): Result<RepoResult, CommandFailedError> {
  const steps = [
    "git checkout main",
    "git pull",
    `git checkout -b ${branch}`,
    "bun update --latest",
    "bun install",
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
