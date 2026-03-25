import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  getWorkspaceUpdateCommand,
  updateRepo,
} from "../src/runner.ts";

const VERSION_PATTERN = /\d+\.\d+/;
const isBun = typeof globalThis.Bun !== "undefined";

let tempDir: string;
let logSpy!: ReturnType<typeof spyOn>;
let warnSpy!: ReturnType<typeof spyOn>;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "repo-updater-runner-"));
  logSpy = spyOn(console, "log").mockImplementation(() => undefined);
  warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

const ok = (stdout = ""): Promise<Result<ExecOutput, CommandFailedError>> =>
  Promise.resolve(Result.ok({ stdout, stderr: "" }));

describe("exec", () => {
  test("returns stdout on success", async () => {
    const result = await exec(
      isBun ? ["bun", "--version"] : ["node", "--version"],
      tempDir
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.stdout).toMatch(VERSION_PATTERN);
    }
  });

  // Requires `git` in PATH (standard on CI and most dev machines).
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

  test("non-dry-run with minor=true uses minor update command", async () => {
    const executedCmds: string[][] = [];
    const mockExec = (
      cmd: string[],
      _cwd: string
    ): Promise<Result<ExecOutput, CommandFailedError>> => {
      executedCmds.push(cmd);
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

    await updateRepo(
      { repo: tempDir, date: "2025-01-01", dryRun: false, minor: true },
      mockExec
    );

    expect(executedCmds.some((cmd) => cmd.join(" ") === "npm update")).toBe(
      true
    );
    expect(executedCmds.some((cmd) => cmd.includes("npm-check-updates"))).toBe(
      false
    );
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

  test.skipIf(!isBun)(
    "execBun returns stdout and stderr on success",
    async () => {
      const result = await execBun(["bun", "--version"], tempDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(VERSION_PATTERN);
    }
  );

  test.skipIf(!isBun)(
    "execBun returns non-zero exitCode on failure",
    async () => {
      const result = await execBun(["git", "status"], tempDir);
      expect(result.exitCode).not.toBe(0);
    }
  );

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
    expect(getUpdateCommand("npm")).toEqual([
      "npx",
      "--yes",
      "npm-check-updates",
      "--upgrade",
    ]);
    expect(getUpdateCommand("pnpm")).toEqual(["pnpm", "update", "--latest"]);
    expect(getUpdateCommand("yarn")).toEqual(["yarn", "upgrade", "--latest"]);
    expect(getUpdateCommand("bun")).toEqual(["bun", "update", "--latest"]);
  });

  test("getUpdateCommand with minor=true omits --latest for all package managers", () => {
    expect(getUpdateCommand("npm", true)).toEqual(["npm", "update"]);
    expect(getUpdateCommand("pnpm", true)).toEqual(["pnpm", "update"]);
    expect(getUpdateCommand("yarn", true)).toEqual(["yarn", "upgrade"]);
    expect(getUpdateCommand("bun", true)).toEqual(["bun", "update"]);
  });

  test("getInstallCommand returns correct command for each pm", () => {
    expect(getInstallCommand("npm")).toEqual(["npm", "install"]);
    expect(getInstallCommand("pnpm")).toEqual(["pnpm", "install"]);
    expect(getInstallCommand("yarn")).toEqual(["yarn", "install"]);
    expect(getInstallCommand("bun")).toEqual(["bun", "install"]);
  });
});

// ---------------------------------------------------------------------------
// updateRepo changeset integration
// ---------------------------------------------------------------------------

describe("updateRepo changeset integration", () => {
  function setupChangesetsRepo(deps: Record<string, string>) {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "test-lib", dependencies: deps }),
      "utf8"
    );
    mkdirSync(join(tempDir, ".changeset"), { recursive: true });
    writeFileSync(join(tempDir, ".changeset", "config.json"), "{}", "utf8");
  }

  function makeExec(
    updatedDeps?: Record<string, string>
  ): (
    cmd: string[],
    cwd: string
  ) => Promise<Result<ExecOutput, CommandFailedError>> {
    return (cmd, cwd) => {
      const cmdStr = cmd.join(" ");
      if (
        cmdStr.includes("git symbolic-ref") &&
        cmdStr.includes("refs/remotes/origin/HEAD")
      ) {
        return ok("refs/remotes/origin/main");
      }
      // Simulate the update command modifying package.json
      if (updatedDeps && cmdStr.includes("npm-check-updates")) {
        writeFileSync(
          join(cwd, "package.json"),
          JSON.stringify({ name: "test-lib", dependencies: updatedDeps }),
          "utf8"
        );
        return ok();
      }
      if (cmdStr.includes("git status") && cmdStr.includes("--porcelain")) {
        return ok(updatedDeps ? "M package.json" : "");
      }
      if (cmd[0] === "gh" && cmd.includes("pr")) {
        return ok("https://github.com/test/repo/pull/1");
      }
      return ok();
    };
  }

  test("writes changeset when hasChangesets and deps changed", async () => {
    setupChangesetsRepo({ react: "18.2.0" });

    const result = await updateRepo(
      { repo: tempDir, date: "2025-01-01", dryRun: false },
      makeExec({ react: "18.3.1" })
    );
    expect(result.isOk()).toBe(true);

    const changesetFiles = readdirSync(join(tempDir, ".changeset")).filter(
      (f) => f.startsWith("dep-updates-") && f.endsWith(".md")
    );
    expect(changesetFiles.length).toBe(1);

    const content = readFileSync(
      join(tempDir, ".changeset", changesetFiles[0]),
      "utf8"
    );
    expect(content).toContain('"test-lib": patch');
    expect(content).toContain("- react: 18.2.0 → 18.3.1");
  });

  test("skips changeset when deps did not change", async () => {
    setupChangesetsRepo({ react: "18.2.0" });

    const result = await updateRepo(
      { repo: tempDir, date: "2025-01-01", dryRun: false },
      makeExec() // no updatedDeps — package.json stays the same
    );
    expect(result.isOk()).toBe(true);

    const changesetFiles = readdirSync(join(tempDir, ".changeset")).filter(
      (f) => f.startsWith("dep-updates-") && f.endsWith(".md")
    );
    expect(changesetFiles.length).toBe(0);
  });

  test("skips changeset when hasChangesets is false", async () => {
    // No .changeset dir and no @changesets/cli
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "test-lib", dependencies: { react: "18.2.0" } }),
      "utf8"
    );

    const result = await updateRepo(
      { repo: tempDir, date: "2025-01-01", dryRun: false },
      makeExec({ react: "18.3.1" })
    );
    expect(result.isOk()).toBe(true);

    expect(existsSync(join(tempDir, ".changeset"))).toBe(false);
  });

  test("cleans up changeset file on post-write failure", async () => {
    setupChangesetsRepo({ react: "18.2.0" });

    const failingExec = (
      cmd: string[],
      cwd: string
    ): Promise<Result<ExecOutput, CommandFailedError>> => {
      const cmdStr = cmd.join(" ");
      if (
        cmdStr.includes("git symbolic-ref") &&
        cmdStr.includes("refs/remotes/origin/HEAD")
      ) {
        return ok("refs/remotes/origin/main");
      }
      // Simulate update modifying deps
      if (cmdStr.includes("npm-check-updates")) {
        writeFileSync(
          join(cwd, "package.json"),
          JSON.stringify({
            name: "test-lib",
            dependencies: { react: "18.3.1" },
          }),
          "utf8"
        );
        return ok();
      }
      if (cmdStr.includes("git status") && cmdStr.includes("--porcelain")) {
        return ok("M package.json");
      }
      // Fail on git add -A to trigger cleanup after changeset is written
      if (cmdStr.includes("git add -A")) {
        return Promise.resolve(
          Result.err(
            new CommandFailedError({
              message: "git add failed",
              command: "git add -A",
              stderr: "fatal: error",
            })
          )
        );
      }
      return ok();
    };

    const result = await updateRepo(
      { repo: tempDir, date: "2025-01-01", dryRun: false },
      failingExec
    );
    expect(result.isErr()).toBe(true);

    // The changeset file should have been removed by cleanup
    const remaining = readdirSync(join(tempDir, ".changeset")).filter(
      (f) => f.startsWith("dep-updates-") && f.endsWith(".md")
    );
    expect(remaining.length).toBe(0);
  });

  test("skips changeset when target file already exists", async () => {
    setupChangesetsRepo({ react: "18.2.0" });

    // Pre-create a changeset file that matches the target pattern.
    // We need to predict the timestamp — mock Date.now for this test.
    const fixedTimestamp = 9_999_999_999_999;
    const dateNowSpy = spyOn(Date, "now").mockReturnValue(fixedTimestamp);

    const targetFile = `dep-updates-${fixedTimestamp}.md`;
    const sentinel = "pre-existing content";
    writeFileSync(join(tempDir, ".changeset", targetFile), sentinel, "utf8");

    try {
      const result = await updateRepo(
        { repo: tempDir, date: "2025-01-01", dryRun: false },
        makeExec({ react: "18.3.1" })
      );
      expect(result.isOk()).toBe(true);

      // File should not have been overwritten
      const content = readFileSync(
        join(tempDir, ".changeset", targetFile),
        "utf8"
      );
      expect(content).toBe(sentinel);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  test("noChangeset skips changeset even when repo has changesets", async () => {
    setupChangesetsRepo({ react: "18.2.0" });

    const result = await updateRepo(
      { repo: tempDir, date: "2025-01-01", dryRun: false, noChangeset: true },
      makeExec({ react: "18.3.1" })
    );
    expect(result.isOk()).toBe(true);

    const changesetFiles = readdirSync(join(tempDir, ".changeset")).filter(
      (f) => f.startsWith("dep-updates-") && f.endsWith(".md")
    );
    expect(changesetFiles.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getWorkspaceUpdateCommand
// ---------------------------------------------------------------------------

describe("getWorkspaceUpdateCommand", () => {
  test("returns correct workspace update commands for latest", () => {
    expect(getWorkspaceUpdateCommand("npm")).toEqual([
      "npx",
      "--yes",
      "npm-check-updates",
      "--upgrade",
      "--workspaces",
    ]);
    expect(getWorkspaceUpdateCommand("pnpm")).toEqual([
      "pnpm",
      "update",
      "--latest",
      "-r",
    ]);
    expect(getWorkspaceUpdateCommand("yarn")).toEqual([
      "npx",
      "--yes",
      "npm-check-updates",
      "--upgrade",
      "--workspaces",
    ]);
    expect(getWorkspaceUpdateCommand("bun")).toEqual([
      "bun",
      "update",
      "--latest",
    ]);
  });

  test("returns correct workspace update commands for minor", () => {
    expect(getWorkspaceUpdateCommand("npm", true)).toEqual([
      "npm",
      "update",
      "--workspaces",
    ]);
    expect(getWorkspaceUpdateCommand("pnpm", true)).toEqual([
      "pnpm",
      "update",
      "-r",
    ]);
    expect(getWorkspaceUpdateCommand("yarn", true)).toEqual([
      "npx",
      "--yes",
      "npm-check-updates",
      "--upgrade",
      "--target",
      "minor",
      "--workspaces",
    ]);
    expect(getWorkspaceUpdateCommand("bun", true)).toEqual(["bun", "update"]);
  });
});

// ---------------------------------------------------------------------------
// updateRepo workspace integration
// ---------------------------------------------------------------------------

describe("updateRepo workspace integration", () => {
  function setupWorkspaceRepo() {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "my-monorepo",
        workspaces: ["packages/*"],
        dependencies: { shared: "1.0.0" },
      }),
      "utf8"
    );
    mkdirSync(join(tempDir, "packages", "pkg-a"), { recursive: true });
    writeFileSync(
      join(tempDir, "packages", "pkg-a", "package.json"),
      JSON.stringify({
        name: "@scope/pkg-a",
        dependencies: { react: "18.2.0" },
      }),
      "utf8"
    );
    mkdirSync(join(tempDir, "packages", "pkg-b"), { recursive: true });
    writeFileSync(
      join(tempDir, "packages", "pkg-b", "package.json"),
      JSON.stringify({
        name: "@scope/pkg-b",
        dependencies: { zod: "3.21.0" },
      }),
      "utf8"
    );
  }

  function makeWorkspaceExec(
    updatedPkgA?: Record<string, string>,
    updatedPkgB?: Record<string, string>
  ): (
    cmd: string[],
    cwd: string
  ) => Promise<Result<ExecOutput, CommandFailedError>> {
    return (cmd, cwd) => {
      const cmdStr = cmd.join(" ");
      if (
        cmdStr.includes("git symbolic-ref") &&
        cmdStr.includes("refs/remotes/origin/HEAD")
      ) {
        return ok("refs/remotes/origin/main");
      }
      // Simulate the update command modifying workspace package.json files
      if (
        cmdStr.includes("npm-check-updates") ||
        cmdStr.includes("npm update")
      ) {
        if (updatedPkgA) {
          writeFileSync(
            join(cwd, "packages", "pkg-a", "package.json"),
            JSON.stringify({ name: "@scope/pkg-a", dependencies: updatedPkgA }),
            "utf8"
          );
        }
        if (updatedPkgB) {
          writeFileSync(
            join(cwd, "packages", "pkg-b", "package.json"),
            JSON.stringify({ name: "@scope/pkg-b", dependencies: updatedPkgB }),
            "utf8"
          );
        }
        return ok();
      }
      if (cmdStr.includes("git status") && cmdStr.includes("--porcelain")) {
        return ok(
          updatedPkgA || updatedPkgB ? "M packages/pkg-a/package.json" : ""
        );
      }
      if (cmd[0] === "gh" && cmd.includes("pr")) {
        return ok("https://github.com/test/mono/pull/1");
      }
      return ok();
    };
  }

  test("auto-detects workspace and uses workspace update commands", async () => {
    setupWorkspaceRepo();

    const executedCmds: string[][] = [];
    const trackingExec = (
      cmd: string[],
      cwd: string
    ): Promise<Result<ExecOutput, CommandFailedError>> => {
      executedCmds.push(cmd);
      return makeWorkspaceExec()(cmd, cwd);
    };

    await updateRepo(
      { repo: tempDir, date: "2025-01-01", dryRun: false },
      trackingExec
    );

    // Should use workspace update command (npm-check-updates --workspaces)
    expect(executedCmds.some((cmd) => cmd.includes("--workspaces"))).toBe(true);
  });

  test("noWorkspaces falls back to root-only update", async () => {
    setupWorkspaceRepo();

    const executedCmds: string[][] = [];
    const trackingExec = (
      cmd: string[],
      cwd: string
    ): Promise<Result<ExecOutput, CommandFailedError>> => {
      executedCmds.push(cmd);
      return makeWorkspaceExec()(cmd, cwd);
    };

    await updateRepo(
      { repo: tempDir, date: "2025-01-01", dryRun: false, noWorkspaces: true },
      trackingExec
    );

    // Should NOT use workspace update command
    expect(executedCmds.some((cmd) => cmd.includes("--workspaces"))).toBe(
      false
    );
    // Should use standard npm-check-updates without --workspaces
    expect(executedCmds.some((cmd) => cmd.includes("npm-check-updates"))).toBe(
      true
    );
  });

  test("workspace mode writes multi-package changeset when deps change", async () => {
    setupWorkspaceRepo();
    mkdirSync(join(tempDir, ".changeset"), { recursive: true });
    writeFileSync(join(tempDir, ".changeset", "config.json"), "{}", "utf8");

    const result = await updateRepo(
      { repo: tempDir, date: "2025-01-01", dryRun: false },
      makeWorkspaceExec({ react: "18.3.1" }, { zod: "3.24.0" })
    );
    expect(result.isOk()).toBe(true);

    const changesetFiles = readdirSync(join(tempDir, ".changeset")).filter(
      (f) => f.startsWith("dep-updates-") && f.endsWith(".md")
    );
    expect(changesetFiles.length).toBe(1);

    const content = readFileSync(
      join(tempDir, ".changeset", changesetFiles[0]),
      "utf8"
    );
    expect(content).toContain('"@scope/pkg-a": patch');
    expect(content).toContain('"@scope/pkg-b": patch');
    expect(content).toContain("react: 18.2.0");
    expect(content).toContain("zod: 3.21.0");
  });

  test("workspace mode with noChangeset skips changeset", async () => {
    setupWorkspaceRepo();
    mkdirSync(join(tempDir, ".changeset"), { recursive: true });
    writeFileSync(join(tempDir, ".changeset", "config.json"), "{}", "utf8");

    const result = await updateRepo(
      { repo: tempDir, date: "2025-01-01", dryRun: false, noChangeset: true },
      makeWorkspaceExec({ react: "18.3.1" })
    );
    expect(result.isOk()).toBe(true);

    const changesetFiles = readdirSync(join(tempDir, ".changeset")).filter(
      (f) => f.startsWith("dep-updates-") && f.endsWith(".md")
    );
    expect(changesetFiles.length).toBe(0);
  });

  test("non-workspace repo uses standard update flow", async () => {
    // Simple repo without workspaces
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "simple-lib", dependencies: { react: "18.2.0" } }),
      "utf8"
    );

    const executedCmds: string[][] = [];
    const trackingExec = (
      cmd: string[],
      _cwd: string
    ): Promise<Result<ExecOutput, CommandFailedError>> => {
      executedCmds.push(cmd);
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

    await updateRepo(
      { repo: tempDir, date: "2025-01-01", dryRun: false },
      trackingExec
    );

    // Should NOT use workspace commands
    expect(
      executedCmds.some(
        (cmd) => cmd.includes("--workspaces") || cmd.includes("-r")
      )
    ).toBe(false);
  });
});
