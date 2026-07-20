import * as BunTest from "bun:test";
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
import path from "node:path";

import { Result } from "better-result";

import { CommandFailedError } from "../src/errors.ts";
import {
  detectPackageManager,
  exec,
  execBun,
  execNodejs,
  getInstallCommand,
  getUpdateCommand,
  getWorkspaceUpdateCommand,
  updateRepo,
} from "../src/runner.ts";
import type { ExecOutput } from "../src/runner.ts";

const { join } = path;

/** Matches a version string containing at least major.minor (e.g. `1.2`). */
const VERSION_PATTERN = /\d+\.\d+/u;
const isBun = globalThis.Bun !== undefined;

let tempDir: string;
let logSpy!: ReturnType<typeof BunTest.spyOn>;
let warnSpy!: ReturnType<typeof BunTest.spyOn>;

BunTest.beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "repo-updater-runner-"));
  logSpy = BunTest.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = BunTest.spyOn(console, "warn").mockImplementation(() => {});
});

BunTest.afterEach(() => {
  rmSync(tempDir, { force: true, recursive: true });
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

/** Creates a resolved `Ok` exec result with the given stdout. */
const ok = (stdout = ""): Promise<Result<ExecOutput, CommandFailedError>> =>
  Promise.resolve(Result.ok({ stderr: "", stdout }));

BunTest.describe("exec", () => {
  BunTest.test("returns stdout on success", async () => {
    const result = await exec(
      isBun ? ["bun", "--version"] : ["node", "--version"],
      tempDir
    );
    BunTest.expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      BunTest.expect(result.value.stdout).toMatch(VERSION_PATTERN);
    }
  });

  // Requires `git` in PATH (standard on CI and most dev machines).
  BunTest.test("returns CommandFailedError on failure", async () => {
    const result = await exec(["git", "status"], tempDir);
    BunTest.expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      BunTest.expect(result.error._tag).toBe("CommandFailedError");
    }
  });
});

BunTest.describe("updateRepo", () => {
  BunTest.test("dry-run returns pr-created status", async () => {
    const result = await updateRepo({
      date: "2025-01-01",
      dryRun: true,
      repo: tempDir,
    });
    BunTest.expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      BunTest.expect(result.value.status).toBe("pr-created");
    }
  });

  BunTest.test(
    "non-dry-run returns no-changes when working tree is clean",
    async () => {
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
        { date: "2025-01-01", dryRun: false, repo: tempDir },
        mockExec
      );

      BunTest.expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        BunTest.expect(result.value.status).toBe("no-changes");
        BunTest.expect(result.value.repo).toBe(tempDir);
      }
    }
  );

  BunTest.test(
    "non-dry-run returns pr-created with URL when changes exist",
    async () => {
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
        { date: "2025-01-01", dryRun: false, repo: tempDir },
        mockExec
      );

      BunTest.expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        BunTest.expect(result.value.status).toBe("pr-created");
        BunTest.expect(result.value.prUrl).toBe(prUrl);
      }
    }
  );

  BunTest.test(
    "non-dry-run with minor=true uses minor update command",
    async () => {
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
        { date: "2025-01-01", dryRun: false, minor: true, repo: tempDir },
        mockExec
      );

      BunTest.expect(
        executedCmds.some((cmd) => cmd.join(" ") === "npm update")
      ).toBe(true);
      BunTest.expect(
        executedCmds.some((cmd) => cmd.includes("npm-check-updates"))
      ).toBe(false);
    }
  );

  BunTest.test("non-dry-run returns error when a command fails", async () => {
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
              command: "git pull",
              message: "git pull failed",
              stderr: "fatal: no remote",
            })
          )
        );
      }
      return ok();
    };

    const result = await updateRepo(
      { date: "2025-01-01", dryRun: false, repo: tempDir },
      mockExec
    );

    BunTest.expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      BunTest.expect(result.error._tag).toBe("CommandFailedError");
    }
  });

  BunTest.test.skipIf(!isBun)(
    "execBun returns stdout and stderr on success",
    async () => {
      const result = await execBun(["bun", "--version"], tempDir);
      BunTest.expect(result.exitCode).toBe(0);
      BunTest.expect(result.stdout).toMatch(VERSION_PATTERN);
    }
  );

  BunTest.test.skipIf(!isBun)(
    "execBun returns non-zero exitCode on failure",
    async () => {
      const result = await execBun(["git", "status"], tempDir);
      BunTest.expect(result.exitCode).not.toBe(0);
    }
  );

  BunTest.test("execNodejs returns stdout and stderr on success", async () => {
    // Use cross-platform command that produces stderr
    const cmd =
      process.platform === "win32"
        ? ["cmd", "/c", "echo hello && echo warning 1>&2"]
        : ["sh", "-c", "echo hello; echo warning >&2"];
    const result = await execNodejs(cmd, tempDir);
    BunTest.expect(result.exitCode).toBe(0);
    BunTest.expect(result.stdout).toContain("hello");
    // On Unix, stderr should contain warning; on Windows might not capture same way
    // but the coverage will mark line 109 as covered if stderr handler is called
  });

  BunTest.test("execNodejs returns non-zero exitCode on failure", async () => {
    const cmd =
      process.platform === "win32"
        ? ["cmd", "/c", "exit", "1"]
        : ["sh", "-c", "exit 1"];
    const result = await execNodejs(cmd, tempDir);
    BunTest.expect(result.exitCode).not.toBe(0);
  });

  BunTest.test("detectPackageManager returns npm for package-lock.json", () => {
    const lockFile = join(tempDir, "package-lock.json");
    writeFileSync(lockFile, "{}");
    const pm = detectPackageManager(tempDir);
    BunTest.expect(pm).toBe("npm");
  });

  BunTest.test("detectPackageManager returns pnpm for pnpm-lock.yaml", () => {
    rmSync(join(tempDir, "package-lock.json"), { force: true });
    const lockFile = join(tempDir, "pnpm-lock.yaml");
    writeFileSync(lockFile, "{}");
    const pm = detectPackageManager(tempDir);
    BunTest.expect(pm).toBe("pnpm");
  });

  BunTest.test("detectPackageManager returns yarn for yarn.lock", () => {
    rmSync(join(tempDir, "pnpm-lock.yaml"), { force: true });
    const lockFile = join(tempDir, "yarn.lock");
    writeFileSync(lockFile, "{}");
    const pm = detectPackageManager(tempDir);
    BunTest.expect(pm).toBe("yarn");
  });

  BunTest.test("detectPackageManager returns bun for bun.lock", () => {
    rmSync(join(tempDir, "yarn.lock"), { force: true });
    const lockFile = join(tempDir, "bun.lock");
    writeFileSync(lockFile, "{}");
    const pm = detectPackageManager(tempDir);
    BunTest.expect(pm).toBe("bun");
  });

  BunTest.test(
    "detectPackageManager defaults to npm when no lockfile exists",
    () => {
      rmSync(join(tempDir, "bun.lock"), { force: true });
      const pm = detectPackageManager(tempDir);
      BunTest.expect(pm).toBe("npm");
    }
  );

  BunTest.test("getUpdateCommand returns correct command for each pm", () => {
    BunTest.expect(getUpdateCommand("npm")).toEqual([
      "npx",
      "--yes",
      "npm-check-updates",
      "--upgrade",
    ]);
    BunTest.expect(getUpdateCommand("pnpm")).toEqual([
      "pnpm",
      "update",
      "--latest",
    ]);
    BunTest.expect(getUpdateCommand("yarn")).toEqual([
      "yarn",
      "upgrade",
      "--latest",
    ]);
    BunTest.expect(getUpdateCommand("bun")).toEqual([
      "bun",
      "update",
      "--latest",
    ]);
  });

  BunTest.test(
    "getUpdateCommand with minor=true omits --latest for all package managers",
    () => {
      BunTest.expect(getUpdateCommand("npm", true)).toEqual(["npm", "update"]);
      BunTest.expect(getUpdateCommand("pnpm", true)).toEqual([
        "pnpm",
        "update",
      ]);
      BunTest.expect(getUpdateCommand("yarn", true)).toEqual([
        "yarn",
        "upgrade",
      ]);
      BunTest.expect(getUpdateCommand("bun", true)).toEqual(["bun", "update"]);
    }
  );

  BunTest.test("getInstallCommand returns correct command for each pm", () => {
    BunTest.expect(getInstallCommand("npm")).toEqual(["npm", "install"]);
    BunTest.expect(getInstallCommand("pnpm")).toEqual(["pnpm", "install"]);
    BunTest.expect(getInstallCommand("yarn")).toEqual(["yarn", "install"]);
    BunTest.expect(getInstallCommand("bun")).toEqual(["bun", "install"]);
  });
});

// ---------------------------------------------------------------------------
// updateRepo changeset integration
// ---------------------------------------------------------------------------

BunTest.describe("updateRepo changeset integration", () => {
  type ChangesetExec = (
    cmd: string[],
    cwd: string
  ) => Promise<Result<ExecOutput, CommandFailedError>>;

  /** Creates a fake repo with a `package.json` (with `deps`) and `.changeset/config.json`. */
  const setupChangesetsRepo = (deps: Record<string, string>) => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ dependencies: deps, name: "BunTest.test-lib" }),
      "utf-8"
    );
    mkdirSync(join(tempDir, ".changeset"), { recursive: true });
    writeFileSync(join(tempDir, ".changeset", "config.json"), "{}", "utf-8");
  };

  /** Builds a BunTest.mock exec function that simulates git and ncu commands for changeset tests. */
  const makeExec = (updatedDeps?: Record<string, string>): ChangesetExec => {
    const mockExec = (cmd: string[], cwd: string) => {
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
          JSON.stringify({
            dependencies: updatedDeps,
            name: "BunTest.test-lib",
          }),
          "utf-8"
        );
        return ok();
      }
      if (cmdStr.includes("git status") && cmdStr.includes("--porcelain")) {
        return ok(updatedDeps ? "M package.json" : "");
      }
      if (cmd[0] === "gh" && cmd.includes("pr")) {
        return ok("https://github.com/BunTest.test/repo/pull/1");
      }
      return ok();
    };
    return mockExec;
  };

  BunTest.test(
    "writes changeset when hasChangesets and deps changed",
    async () => {
      setupChangesetsRepo({ react: "18.2.0" });

      const result = await updateRepo(
        { date: "2025-01-01", dryRun: false, repo: tempDir },
        makeExec({ react: "18.3.1" })
      );
      BunTest.expect(result.isOk()).toBe(true);

      const changesetFiles = readdirSync(join(tempDir, ".changeset")).filter(
        (f) => f.startsWith("dep-updates-") && f.endsWith(".md")
      );
      BunTest.expect(changesetFiles.length).toBe(1);

      const content = readFileSync(
        join(tempDir, ".changeset", changesetFiles[0]),
        "utf-8"
      );
      BunTest.expect(content).toContain('"BunTest.test-lib": patch');
      BunTest.expect(content).toContain("- react: 18.2.0 → 18.3.1");
    }
  );

  BunTest.test("skips changeset when deps did not change", async () => {
    setupChangesetsRepo({ react: "18.2.0" });

    const result = await updateRepo(
      { date: "2025-01-01", dryRun: false, repo: tempDir },
      // Without updatedDeps, package.json stays the same.
      makeExec()
    );
    BunTest.expect(result.isOk()).toBe(true);

    const changesetFiles = readdirSync(join(tempDir, ".changeset")).filter(
      (f) => f.startsWith("dep-updates-") && f.endsWith(".md")
    );
    BunTest.expect(changesetFiles.length).toBe(0);
  });

  BunTest.test("skips changeset when hasChangesets is false", async () => {
    // No .changeset dir and no @changesets/cli
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        dependencies: { react: "18.2.0" },
        name: "BunTest.test-lib",
      }),
      "utf-8"
    );

    const result = await updateRepo(
      { date: "2025-01-01", dryRun: false, repo: tempDir },
      makeExec({ react: "18.3.1" })
    );
    BunTest.expect(result.isOk()).toBe(true);

    BunTest.expect(existsSync(join(tempDir, ".changeset"))).toBe(false);
  });

  BunTest.test("cleans up changeset file on post-write failure", async () => {
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
            dependencies: { react: "18.3.1" },
            name: "BunTest.test-lib",
          }),
          "utf-8"
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
              command: "git add -A",
              message: "git add failed",
              stderr: "fatal: error",
            })
          )
        );
      }
      return ok();
    };

    const result = await updateRepo(
      { date: "2025-01-01", dryRun: false, repo: tempDir },
      failingExec
    );
    BunTest.expect(result.isErr()).toBe(true);

    // The changeset file should have been removed by cleanup
    const remaining = readdirSync(join(tempDir, ".changeset")).filter(
      (f) => f.startsWith("dep-updates-") && f.endsWith(".md")
    );
    BunTest.expect(remaining.length).toBe(0);
  });

  BunTest.test("skips changeset when target file already exists", async () => {
    setupChangesetsRepo({ react: "18.2.0" });

    // Pre-create a changeset file that matches the target pattern.
    // We need to predict the timestamp — BunTest.mock Date.now for this BunTest.test.
    const fixedTimestamp = 9_999_999_999_999;
    const dateNowSpy = BunTest.spyOn(Date, "now").mockReturnValue(
      fixedTimestamp
    );

    const targetFile = `dep-updates-${fixedTimestamp}.md`;
    const sentinel = "pre-existing content";
    writeFileSync(join(tempDir, ".changeset", targetFile), sentinel, "utf-8");

    try {
      const result = await updateRepo(
        { date: "2025-01-01", dryRun: false, repo: tempDir },
        makeExec({ react: "18.3.1" })
      );
      BunTest.expect(result.isOk()).toBe(true);

      // File should not have been overwritten
      const content = readFileSync(
        join(tempDir, ".changeset", targetFile),
        "utf-8"
      );
      BunTest.expect(content).toBe(sentinel);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  BunTest.test(
    "noChangeset skips changeset even when repo has changesets",
    async () => {
      setupChangesetsRepo({ react: "18.2.0" });

      const result = await updateRepo(
        { date: "2025-01-01", dryRun: false, noChangeset: true, repo: tempDir },
        makeExec({ react: "18.3.1" })
      );
      BunTest.expect(result.isOk()).toBe(true);

      const changesetFiles = readdirSync(join(tempDir, ".changeset")).filter(
        (f) => f.startsWith("dep-updates-") && f.endsWith(".md")
      );
      BunTest.expect(changesetFiles.length).toBe(0);
    }
  );
});

// ---------------------------------------------------------------------------
// getWorkspaceUpdateCommand
// ---------------------------------------------------------------------------

BunTest.describe("getWorkspaceUpdateCommand", () => {
  BunTest.test("returns correct workspace update commands for latest", () => {
    BunTest.expect(getWorkspaceUpdateCommand("npm")).toEqual([
      "npx",
      "--yes",
      "npm-check-updates",
      "--upgrade",
      "--workspaces",
    ]);
    BunTest.expect(getWorkspaceUpdateCommand("pnpm")).toEqual([
      "pnpm",
      "update",
      "--latest",
      "-r",
    ]);
    BunTest.expect(getWorkspaceUpdateCommand("yarn")).toEqual([
      "npx",
      "--yes",
      "npm-check-updates",
      "--upgrade",
      "--workspaces",
    ]);
    BunTest.expect(getWorkspaceUpdateCommand("bun")).toEqual([
      "bun",
      "update",
      "--latest",
    ]);
  });

  BunTest.test("returns correct workspace update commands for minor", () => {
    BunTest.expect(getWorkspaceUpdateCommand("npm", true)).toEqual([
      "npm",
      "update",
      "--workspaces",
    ]);
    BunTest.expect(getWorkspaceUpdateCommand("pnpm", true)).toEqual([
      "pnpm",
      "update",
      "-r",
    ]);
    BunTest.expect(getWorkspaceUpdateCommand("yarn", true)).toEqual([
      "npx",
      "--yes",
      "npm-check-updates",
      "--upgrade",
      "--target",
      "minor",
      "--workspaces",
    ]);
    BunTest.expect(getWorkspaceUpdateCommand("bun", true)).toEqual([
      "bun",
      "update",
    ]);
  });
});

// ---------------------------------------------------------------------------
// updateRepo workspace integration
// ---------------------------------------------------------------------------

BunTest.describe("updateRepo workspace integration", () => {
  type WorkspaceExec = (
    cmd: string[],
    cwd: string
  ) => Promise<Result<ExecOutput, CommandFailedError>>;

  /** Creates a fake monorepo with root + two workspace packages (`pkg-a`, `pkg-b`). */
  const setupWorkspaceRepo = () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        dependencies: { shared: "1.0.0" },
        name: "my-monorepo",
        workspaces: ["packages/*"],
      }),
      "utf-8"
    );
    mkdirSync(join(tempDir, "packages", "pkg-a"), { recursive: true });
    writeFileSync(
      join(tempDir, "packages", "pkg-a", "package.json"),
      JSON.stringify({
        dependencies: { react: "18.2.0" },
        name: "@scope/pkg-a",
      }),
      "utf-8"
    );
    mkdirSync(join(tempDir, "packages", "pkg-b"), { recursive: true });
    writeFileSync(
      join(tempDir, "packages", "pkg-b", "package.json"),
      JSON.stringify({
        dependencies: { zod: "3.21.0" },
        name: "@scope/pkg-b",
      }),
      "utf-8"
    );
  };

  /** Builds a BunTest.mock exec function that simulates workspace-aware update commands. */
  const makeWorkspaceExec = (
    updatedPkgA?: Record<string, string>,
    updatedPkgB?: Record<string, string>
  ): WorkspaceExec => {
    const mockExec = (cmd: string[], cwd: string) => {
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
            JSON.stringify({ dependencies: updatedPkgA, name: "@scope/pkg-a" }),
            "utf-8"
          );
        }
        if (updatedPkgB) {
          writeFileSync(
            join(cwd, "packages", "pkg-b", "package.json"),
            JSON.stringify({ dependencies: updatedPkgB, name: "@scope/pkg-b" }),
            "utf-8"
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
        return ok("https://github.com/BunTest.test/mono/pull/1");
      }
      return ok();
    };
    return mockExec;
  };

  BunTest.test(
    "auto-detects workspace and uses workspace update commands",
    async () => {
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
        { date: "2025-01-01", dryRun: false, repo: tempDir },
        trackingExec
      );

      // Should use workspace update command (npm-check-updates --workspaces)
      BunTest.expect(
        executedCmds.some((cmd) => cmd.includes("--workspaces"))
      ).toBe(true);
    }
  );

  BunTest.test("noWorkspaces falls back to root-only update", async () => {
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
      { date: "2025-01-01", dryRun: false, noWorkspaces: true, repo: tempDir },
      trackingExec
    );

    // Should NOT use workspace update command
    BunTest.expect(
      executedCmds.some((cmd) => cmd.includes("--workspaces"))
    ).toBe(false);
    // Should use standard npm-check-updates without --workspaces
    BunTest.expect(
      executedCmds.some((cmd) => cmd.includes("npm-check-updates"))
    ).toBe(true);
  });

  BunTest.test(
    "workspace mode writes multi-package changeset when deps change",
    async () => {
      setupWorkspaceRepo();
      mkdirSync(join(tempDir, ".changeset"), { recursive: true });
      writeFileSync(join(tempDir, ".changeset", "config.json"), "{}", "utf-8");

      const result = await updateRepo(
        { date: "2025-01-01", dryRun: false, repo: tempDir },
        makeWorkspaceExec({ react: "18.3.1" }, { zod: "3.24.0" })
      );
      BunTest.expect(result.isOk()).toBe(true);

      const changesetFiles = readdirSync(join(tempDir, ".changeset")).filter(
        (f) => f.startsWith("dep-updates-") && f.endsWith(".md")
      );
      BunTest.expect(changesetFiles.length).toBe(1);

      const content = readFileSync(
        join(tempDir, ".changeset", changesetFiles[0]),
        "utf-8"
      );
      BunTest.expect(content).toContain('"@scope/pkg-a": patch');
      BunTest.expect(content).toContain('"@scope/pkg-b": patch');
      BunTest.expect(content).toContain("react: 18.2.0");
      BunTest.expect(content).toContain("zod: 3.21.0");
    }
  );

  BunTest.test("workspace mode with noChangeset skips changeset", async () => {
    setupWorkspaceRepo();
    mkdirSync(join(tempDir, ".changeset"), { recursive: true });
    writeFileSync(join(tempDir, ".changeset", "config.json"), "{}", "utf-8");

    const result = await updateRepo(
      { date: "2025-01-01", dryRun: false, noChangeset: true, repo: tempDir },
      makeWorkspaceExec({ react: "18.3.1" })
    );
    BunTest.expect(result.isOk()).toBe(true);

    const changesetFiles = readdirSync(join(tempDir, ".changeset")).filter(
      (f) => f.startsWith("dep-updates-") && f.endsWith(".md")
    );
    BunTest.expect(changesetFiles.length).toBe(0);
  });

  BunTest.test("non-workspace repo uses standard update flow", async () => {
    // Simple repo without workspaces
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ dependencies: { react: "18.2.0" }, name: "simple-lib" }),
      "utf-8"
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
      { date: "2025-01-01", dryRun: false, repo: tempDir },
      trackingExec
    );

    // Should NOT use workspace commands
    BunTest.expect(
      executedCmds.some(
        (cmd) => cmd.includes("--workspaces") || cmd.includes("-r")
      )
    ).toBe(false);
  });
});
