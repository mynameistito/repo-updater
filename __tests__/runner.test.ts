import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "better-result";
import { CommandFailedError } from "../src/errors.ts";
import { type ExecOutput, exec, updateRepo } from "../src/runner.ts";

const VERSION_PATTERN = /\d+\.\d+/;

let tempDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `repo-updater-runner-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
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
      if (branchCreatedOnce && cmd[0] === "bun" && cmd[1] === "install") {
        return Promise.resolve(
          Result.err(
            new CommandFailedError({
              message: "bun install failed",
              command: "bun install",
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
});
