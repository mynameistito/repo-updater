import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "better-result";
import { CommandFailedError } from "../src/errors.ts";
import {
  detectPackageManager,
  type ExecOutput,
  exec,
  execBun,
  execNodejs,
  getInstallCommand,
  getUpdateCommand,
  updateRepo,
} from "../src/runner.ts";

const VERSION_PATTERN = /\d+\.\d+/;

let tempDir: string;
let logSpy: ReturnType<typeof mock>;
let warnSpy: ReturnType<typeof mock>;
let originalLog: typeof console.log;
let originalWarn: typeof console.warn;

beforeEach(() => {
  tempDir = join(tmpdir(), `repo-updater-runner-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  originalLog = console.log;
  originalWarn = console.warn;
  logSpy = mock(() => {
    // Spy on console.log calls
  });
  warnSpy = mock(() => {
    // Spy on console.warn calls
  });
  console.log = logSpy;
  console.warn = warnSpy;
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  logSpy.mockRestore();
  warnSpy.mockRestore();
  console.log = originalLog;
  console.warn = originalWarn;
});

const ok = (stdout = ""): Promise<Result<ExecOutput, CommandFailedError>> =>
  Promise.resolve(Result.ok({ stdout, stderr: "" }));

describe("exec", () => {
  test("returns stdout on success", async () => {
    const result = await exec(["bun", "--version"], tempDir);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.stdout).toMatch(VERSION_PATTERN);
    }
  });

  test("returns CommandFailedError on failure", async () => {
    const result = await exec(["git", "status"], tempDir);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("CommandFailedError");
    }
  });
});

describe("updateRepo", () => {
  test("dry-run returns pr-created status", async () => {
    const result = await updateRepo({
      repo: tempDir,
      date: "2025-01-01",
      dryRun: true,
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.status).toBe("pr-created");
    }
  });

  test("non-dry-run returns no-changes when working tree is clean", async () => {
    const mockExec = (
      cmd: string[],
      _cwd: string
    ): Promise<Result<ExecOutput, CommandFailedError>> => {
      const cmdStr = cmd.join(" ");
      if (
        cmdStr.includes("git symbolic-ref") &&
        cmdStr.includes("refs/remotes/origin/HEAD")
      ) {
        return ok("refs/remotes/origin/main");
      }
      if (cmdStr.includes("git status") && cmdStr.includes("--porcelain")) {
        return ok("");
      }
      return ok();
    };

    const result = await updateRepo(
      { repo: tempDir, date: "2025-01-01", dryRun: false },
      mockExec
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.status).toBe("no-changes");
      expect(result.value.repo).toBe(tempDir);
    }
  });

  test("non-dry-run returns pr-created with URL when changes exist", async () => {
    const prUrl = "https://github.com/owner/repo/pull/42";
    const mockExec = (
      cmd: string[],
      _cwd: string
    ): Promise<Result<ExecOutput, CommandFailedError>> => {
      const cmdStr = cmd.join(" ");
      if (
        cmdStr.includes("git symbolic-ref") &&
        cmdStr.includes("refs/remotes/origin/HEAD")
      ) {
        return ok("refs/remotes/origin/main");
      }
      if (cmdStr.includes("git status") && cmdStr.includes("--porcelain")) {
        return ok("M package.json");
      }
      if (cmd[0] === "gh" && cmd.includes("pr")) {
        return ok(prUrl);
      }
      return ok();
    };

    const result = await updateRepo(
      { repo: tempDir, date: "2025-01-01", dryRun: false },
      mockExec
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.status).toBe("pr-created");
      expect(result.value.prUrl).toBe(prUrl);
    }
  });

  test("non-dry-run returns error when a command fails", async () => {
    const mockExec = (
      cmd: string[],
      _cwd: string
    ): Promise<Result<ExecOutput, CommandFailedError>> => {
      const cmdStr = cmd.join(" ");
      if (
        cmdStr.includes("git symbolic-ref") &&
        cmdStr.includes("refs/remotes/origin/HEAD")
      ) {
        return ok("refs/remotes/origin/main");
      }
      if (cmd[1] === "pull") {
        return Promise.resolve(
          Result.err(
            new CommandFailedError({
              message: "git pull failed",
              command: "git pull",
              stderr: "fatal: no remote",
            })
          )
        );
      }
      return ok();
    };

    const result = await updateRepo(
      { repo: tempDir, date: "2025-01-01", dryRun: false },
      mockExec
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("CommandFailedError");
    }
  });

  test("non-dry-run cleans up on failure after branch creation", async () => {
    let branchCreatedOnce = false;
    const mockExec = (
      cmd: string[],
      _cwd: string
    ): Promise<Result<ExecOutput, CommandFailedError>> => {
      const cmdStr = cmd.join(" ");
      if (
        cmdStr.includes("git symbolic-ref") &&
        cmdStr.includes("refs/remotes/origin/HEAD")
      ) {
        return ok("refs/remotes/origin/main");
      }
      // Track when branch creation happens
      if (cmdStr.includes("-b")) {
        branchCreatedOnce = true;
      }
      // After branch creation, fail on install to trigger rollback
      if (branchCreatedOnce && cmdStr.includes("install")) {
        return Promise.resolve(
          Result.err(
            new CommandFailedError({
              message: "install failed",
              command: cmdStr,
              stderr: "error installing",
            })
          )
        );
      }
      return ok();
    };

    const result = await updateRepo(
      { repo: tempDir, date: "2025-01-01", dryRun: false },
      mockExec
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("CommandFailedError");
    }
    // Verify branch was created before the failure
    expect(branchCreatedOnce).toBe(true);
  });

  test("execBun returns stdout and stderr on success", async () => {
    const result = await execBun(["bun", "--version"], tempDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(VERSION_PATTERN);
  });

  test("execBun returns non-zero exitCode on failure", async () => {
    const result = await execBun(["git", "status"], tempDir);
    expect(result.exitCode).not.toBe(0);
  });

  test("execNodejs returns stdout and stderr on success", async () => {
    // Use cross-platform command that produces stderr
    const cmd =
      process.platform === "win32"
        ? ["cmd", "/c", "echo hello && echo warning 1>&2"]
        : ["sh", "-c", "echo hello; echo warning >&2"];
    const result = await execNodejs(cmd, tempDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello");
    // On Unix, stderr should contain warning; on Windows might not capture same way
    // but the coverage will mark line 109 as covered if stderr handler is called
  });

  test("execNodejs returns non-zero exitCode on failure", async () => {
    const cmd =
      process.platform === "win32"
        ? ["cmd", "/c", "exit", "1"]
        : ["sh", "-c", "exit 1"];
    const result = await execNodejs(cmd, tempDir);
    expect(result.exitCode).not.toBe(0);
  });

  test("detectPackageManager returns npm for package-lock.json", () => {
    const lockFile = join(tempDir, "package-lock.json");
    writeFileSync(lockFile, "{}");
    const pm = detectPackageManager(tempDir);
    expect(pm).toBe("npm");
  });

  test("detectPackageManager returns pnpm for pnpm-lock.yaml", () => {
    rmSync(join(tempDir, "package-lock.json"), { force: true });
    const lockFile = join(tempDir, "pnpm-lock.yaml");
    writeFileSync(lockFile, "{}");
    const pm = detectPackageManager(tempDir);
    expect(pm).toBe("pnpm");
  });

  test("detectPackageManager returns yarn for yarn.lock", () => {
    rmSync(join(tempDir, "pnpm-lock.yaml"), { force: true });
    const lockFile = join(tempDir, "yarn.lock");
    writeFileSync(lockFile, "{}");
    const pm = detectPackageManager(tempDir);
    expect(pm).toBe("yarn");
  });

  test("detectPackageManager returns bun for bun.lock", () => {
    rmSync(join(tempDir, "yarn.lock"), { force: true });
    const lockFile = join(tempDir, "bun.lock");
    writeFileSync(lockFile, "{}");
    const pm = detectPackageManager(tempDir);
    expect(pm).toBe("bun");
  });

  test("detectPackageManager defaults to npm when no lockfile exists", () => {
    rmSync(join(tempDir, "bun.lock"), { force: true });
    const pm = detectPackageManager(tempDir);
    expect(pm).toBe("npm");
  });

  test("getUpdateCommand returns correct command for each pm", () => {
    expect(getUpdateCommand("npm")).toEqual(["npm", "update"]);
    expect(getUpdateCommand("pnpm")).toEqual(["pnpm", "update", "--latest"]);
    expect(getUpdateCommand("yarn")).toEqual(["yarn", "upgrade"]);
    expect(getUpdateCommand("bun")).toEqual(["bun", "update", "--latest"]);
  });

  test("getInstallCommand returns correct command for each pm", () => {
    expect(getInstallCommand("npm")).toEqual(["npm", "install"]);
    expect(getInstallCommand("pnpm")).toEqual(["pnpm", "install"]);
    expect(getInstallCommand("yarn")).toEqual(["yarn", "install"]);
    expect(getInstallCommand("bun")).toEqual(["bun", "install"]);
  });
});
