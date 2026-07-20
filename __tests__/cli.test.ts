import * as BunTest from "bun:test";
import { spawn as realSpawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Result } from "better-result";

import { CommandFailedError } from "../src/errors.ts";
import type { RepoResult } from "../src/runner.ts";

const { join } = path;

/** No-op function used as default BunTest.mock implementation. */
const noop = () => {};

/** Mock object for the `@clack/prompts` `log` utility. */
const logMock = {
  error: BunTest.mock(noop),
  info: BunTest.mock(noop),
  step: BunTest.mock(noop),
  success: BunTest.mock(noop),
  warn: BunTest.mock(noop),
};

/** Mock spinner instance returned by the `@clack/prompts` `spinner()` factory. */
const spinnerInstance = {
  start: BunTest.mock(noop),
  stop: BunTest.mock(noop),
};

/** Mock for `@clack/prompts` `confirm()`. Defaults to declining. */
const confirmMock = BunTest.mock(() => Promise.resolve(false));

/** Mock for `@clack/prompts` `note()`. */
const noteMock = BunTest.mock(noop);

/** Mock for `@clack/prompts` `outro()`. */
const outroMock = BunTest.mock(noop);

/** Mock for `@clack/prompts` `isCancel()`. Always returns `false` by default. */
const isCancelMock = BunTest.mock((_val: unknown) => false);

/** Mock replacing `console.log` to suppress output during tests. */
const consoleLogMock = BunTest.mock(noop);

// Capture the real function value BEFORE BunTest.mock.module overwrites the live
// ES-module binding — otherwise `realSpawn` inside the closure would point
// back to `spawnMock` and recurse infinitely.
const capturedSpawn = realSpawn;

/** Mock for `node:child_process` `spawn`.
 * Intercepts fire-and-forget calls from `openURLNodejs` (stdio: "ignore").
 * Delegates to the real spawn for all other callers (e.g. `execNodejs`). */
const spawnMock = BunTest.mock(
  (cmd: string, args: string[], opts?: Parameters<typeof realSpawn>[2]) => {
    if (opts && "stdio" in opts && opts.stdio === "ignore") {
      const child = new EventTarget() as EventTarget & { unref: () => void };
      child.unref = BunTest.mock(noop);
      queueMicrotask(() => child.dispatchEvent(new Event("spawn")));
      return child as unknown as ReturnType<typeof realSpawn>;
    }
    return capturedSpawn(cmd, args, opts as Parameters<typeof realSpawn>[2]);
  }
);

BunTest.mock.module("node:child_process", () => ({
  spawn: spawnMock,
}));

BunTest.mock.module("@clack/prompts", () => ({
  confirm: confirmMock,
  intro: BunTest.mock(noop),
  isCancel: isCancelMock,
  log: logMock,
  note: noteMock,
  outro: outroMock,
  spinner: () => spinnerInstance,
}));

const {
  detectBrowser,
  main,
  openURLBun,
  openURLNodejs,
  openURLs,
  printUsage,
  processRepo,
  resolveRepos,
} = await import("../src/index.ts");

let tempDir: string;
let originalConsoleLog: typeof console.log;

/** Creates a resolved `Ok` result wrapping a BunTest.mock {@link RepoResult}. */
const okResult = (
  repo: string,
  status: "no-changes" | "pr-created",
  prUrl?: string
) =>
  Promise.resolve(
    Result.ok<RepoResult, CommandFailedError>({ prUrl, repo, status })
  );

/** Creates a resolved `Err` result wrapping a {@link CommandFailedError}. */
const errResult = (message: string, command: string, stderr: string) =>
  Promise.resolve(
    Result.err<RepoResult, CommandFailedError>(
      new CommandFailedError({ command, message, stderr })
    )
  );

BunTest.beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "cli-BunTest.test-"));
  mkdirSync(path.join(tempDir, ".git"), { recursive: true });
  originalConsoleLog = console.log;
  console.log = consoleLogMock;
  confirmMock.mockReset();
  noteMock.mockClear();
  outroMock.mockClear();
  consoleLogMock.mockClear();
  for (const fn of Object.values(logMock)) {
    fn.mockClear();
  }
  spinnerInstance.start.mockClear();
  spinnerInstance.stop.mockClear();
  isCancelMock.mockClear();
  spawnMock.mockClear();
});

BunTest.afterEach(() => {
  console.log = originalConsoleLog;
  rmSync(tempDir, { force: true, recursive: true });
});

// Restore the real node:child_process after all cli tests so later BunTest.test files
// (e.g. runner.test.ts) are not affected by the module-level BunTest.mock.
BunTest.afterAll(() => {
  BunTest.mock.module("node:child_process", () => ({ spawn: realSpawn }));
});

BunTest.describe("printUsage", () => {
  BunTest.test("prints usage text", () => {
    BunTest.expect(() => printUsage()).not.toThrow();
  });
});

BunTest.describe("resolveRepos", () => {
  BunTest.test("returns positional args directly", () => {
    const result = resolveRepos({
      browser: undefined,
      configPath: undefined,
      dryRun: false,
      help: false,
      minor: false,
      noChangeset: false,
      noWorkspaces: false,
      positional: ["/repo1", "/repo2"],
    });
    BunTest.expect(result?.repos).toEqual(["/repo1", "/repo2"]);
  });

  BunTest.test("dry-run returns result without pushing prUrls", () => {
    const prUrls: string[] = [];
    const result = resolveRepos({
      browser: undefined,
      configPath: undefined,
      dryRun: true,
      help: false,
      minor: false,
      noChangeset: false,
      noWorkspaces: false,
      positional: ["/repo1", "/repo2"],
    });
    BunTest.expect(result?.repos).toEqual(["/repo1", "/repo2"]);
    BunTest.expect(prUrls).toHaveLength(0);
  });

  BunTest.test("loads repos from config file", () => {
    const configPath = path.join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ repos: ["/a", "/b"] }));
    const result = resolveRepos({
      browser: undefined,
      configPath,
      dryRun: false,
      help: false,
      minor: false,
      noChangeset: false,
      noWorkspaces: false,
      positional: [],
    });
    BunTest.expect(result?.repos).toEqual(["/a", "/b"]);
  });

  BunTest.test("returns null when config is not found", () => {
    const repos = resolveRepos({
      browser: undefined,
      configPath: join(tempDir, "missing.json"),
      dryRun: false,
      help: false,
      minor: false,
      noChangeset: false,
      noWorkspaces: false,
      positional: [],
    });
    BunTest.expect(repos).toBeNull();
    BunTest.expect(logMock.error).toHaveBeenCalled();
  });
});

BunTest.describe("processRepo", () => {
  BunTest.test("dry-run ok returns result value", async () => {
    const updateFn = BunTest.mock((opts: { repo: string }) =>
      okResult(opts.repo, "pr-created", "https://example.com/pr/1")
    );
    const result = await processRepo(tempDir, "2025-01-01", true, updateFn);
    BunTest.expect(result.status).toBe("pr-created");
  });

  BunTest.test("dry-run error returns failed", async () => {
    const updateFn = BunTest.mock(() => errResult("fail", "git", "error"));
    const result = await processRepo(tempDir, "2025-01-01", true, updateFn);
    BunTest.expect(result.status).toBe("failed");
  });

  BunTest.test("non-dry-run no-changes logs info", async () => {
    const updateFn = BunTest.mock((opts: { repo: string }) =>
      okResult(opts.repo, "no-changes")
    );
    const result = await processRepo(tempDir, "2025-01-01", false, updateFn);
    BunTest.expect(result.status).toBe("no-changes");
  });

  BunTest.test("non-dry-run pr-created pushes URL", async () => {
    const url = "https://github.com/owner/repo/pull/1";
    const updateFn = BunTest.mock((opts: { repo: string }) =>
      okResult(opts.repo, "pr-created", url)
    );
    const result = await processRepo(tempDir, "2025-01-01", false, updateFn);
    BunTest.expect(result.status).toBe("pr-created");
    BunTest.expect(result.prUrl).toEqual(url);
  });

  BunTest.test("non-dry-run error returns failed and logs stderr", async () => {
    const updateFn = BunTest.mock(() =>
      errResult("git pull failed", "git pull", "fatal: no remote")
    );
    const result = await processRepo(tempDir, "2025-01-01", false, updateFn);
    BunTest.expect(result.status).toBe("failed");
    BunTest.expect(logMock.error).toHaveBeenCalledTimes(2);
  });

  BunTest.test(
    "non-dry-run pr-created without prUrl logs success with repo name",
    async () => {
      const updateFn = BunTest.mock((opts: { repo: string }) =>
        okResult(opts.repo, "pr-created")
      );
      const result = await processRepo(tempDir, "2025-01-01", false, updateFn);
      BunTest.expect(result.status).toBe("pr-created");
      BunTest.expect(logMock.success).toHaveBeenCalled();
    }
  );
});

BunTest.describe("main", () => {
  const noopUpdate = BunTest.mock((opts: { repo: string }) =>
    okResult(opts.repo, "no-changes")
  );

  let exitSpy: ReturnType<typeof BunTest.spyOn>;

  BunTest.afterEach(() => {
    if (exitSpy) {
      exitSpy.mockRestore();
    }
  });

  BunTest.test("--help prints usage and exits", async () => {
    exitSpy = BunTest.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    try {
      await BunTest.expect(main(["--help"], noopUpdate)).rejects.toThrow(
        "exit"
      );
      BunTest.expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      exitSpy.mockRestore();
    }
  });

  BunTest.test("exits when config not found", async () => {
    exitSpy = BunTest.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    try {
      await BunTest.expect(
        main(["-c", path.join(tempDir, "missing.json")], noopUpdate)
      ).rejects.toThrow("exit");
      BunTest.expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });

  BunTest.test("exits when no valid repos found", async () => {
    exitSpy = BunTest.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    try {
      await BunTest.expect(
        main([path.join(tempDir, "nonexistent")], noopUpdate)
      ).rejects.toThrow("exit");
      BunTest.expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });

  BunTest.test("warns about missing repos", async () => {
    const validDir = path.join(tempDir, "valid");
    mkdirSync(path.join(validDir, ".git"), { recursive: true });
    await main([validDir, join(tempDir, "nonexistent")], noopUpdate);
    BunTest.expect(logMock.warn).toHaveBeenCalled();
  });

  BunTest.test("shows dry-run message", async () => {
    await main(["-n", tempDir], noopUpdate);
    BunTest.expect(logMock.info).toHaveBeenCalled();
  });

  BunTest.test("shows no-PRs message when no changes", async () => {
    await main([tempDir], noopUpdate);
    BunTest.expect(logMock.info).toHaveBeenCalledWith(
      "No pull requests were created."
    );
  });

  BunTest.test(
    "shows PR URLs and opens in browser when confirmed",
    async () => {
      const url = "https://github.com/owner/repo/pull/1";
      const prUpdate = BunTest.mock((opts: { repo: string }) =>
        okResult(opts.repo, "pr-created", url)
      );
      confirmMock.mockResolvedValue(true);

      await main([tempDir], prUpdate);

      BunTest.expect(noteMock).toHaveBeenCalled();
      BunTest.expect(confirmMock).toHaveBeenCalled();
      BunTest.expect(spawnMock).toHaveBeenCalled();
    }
  );

  BunTest.test(
    "uses browser from config file when opening PR URLs",
    async () => {
      const url = "https://github.com/owner/repo/pull/1";
      const browser =
        "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";
      const configPath = path.join(tempDir, "config.json");
      writeFileSync(configPath, JSON.stringify({ browser, repos: [tempDir] }));
      const prUpdate = BunTest.mock((opts: { repo: string }) =>
        okResult(opts.repo, "pr-created", url)
      );
      confirmMock.mockResolvedValue(true);

      await main(["--config", configPath], prUpdate);

      BunTest.expect(logMock.info).toHaveBeenCalledWith(
        `Using browser: ${browser}`
      );
      BunTest.expect(spawnMock).toHaveBeenCalledTimes(1);
      BunTest.expect(spawnMock).toHaveBeenLastCalledWith(
        browser,
        ["--new-window", url],
        {
          stdio: "ignore",
          windowsHide: true,
        }
      );
    }
  );

  BunTest.test("does not open browser when declined", async () => {
    const url = "https://github.com/owner/repo/pull/1";
    const prUpdate = BunTest.mock((opts: { repo: string }) =>
      okResult(opts.repo, "pr-created", url)
    );
    confirmMock.mockResolvedValue(false);

    await main([tempDir], prUpdate);

    BunTest.expect(noteMock).toHaveBeenCalled();
    BunTest.expect(spawnMock).not.toHaveBeenCalled();
  });

  BunTest.test("exits when user cancels PR confirmation", async () => {
    const url = "https://github.com/owner/repo/pull/1";
    const prUpdate = BunTest.mock((opts: { repo: string }) =>
      okResult(opts.repo, "pr-created", url)
    );
    isCancelMock.mockReturnValue(true);
    const cancelExitSpy = BunTest.spyOn(process, "exit").mockImplementation(
      () => {
        throw new Error("exit");
      }
    );

    try {
      await BunTest.expect(main([tempDir], prUpdate)).rejects.toThrow("exit");
      BunTest.expect(cancelExitSpy).toHaveBeenCalledWith(0);
    } finally {
      cancelExitSpy.mockRestore();
    }
  });

  BunTest.test(
    "openURLs uses osascript on darwin when browser not detected",
    async () => {
      const noopExec = BunTest.mock(() =>
        Promise.resolve({ exitCode: 1, stderr: "", stdout: "" })
      );

      await openURLs(["https://example.com/2"], "darwin", noopExec);
      BunTest.expect(spawnMock).toHaveBeenCalledTimes(1);
      BunTest.expect(spawnMock).toHaveBeenLastCalledWith(
        "osascript",
        ["-e", 'open location "https://example.com/2"'],
        { stdio: "ignore", windowsHide: true }
      );
    }
  );

  BunTest.test(
    "openURLs falls back to cmd start on win32 when browser not detected",
    async () => {
      const noopExec = BunTest.mock(() =>
        Promise.resolve({ exitCode: 1, stderr: "", stdout: "" })
      );

      await openURLs(["https://example.com/1"], "win32", noopExec);
      BunTest.expect(spawnMock).toHaveBeenLastCalledWith(
        "cmd",
        ["/c", "start", "", "https://example.com/1"],
        { stdio: "ignore", windowsHide: true }
      );
    }
  );

  BunTest.test(
    "openURLs batches URLs via osascript on darwin without detected browser",
    async () => {
      const noopExec = BunTest.mock(() =>
        Promise.resolve({ exitCode: 1, stderr: "", stdout: "" })
      );

      await openURLs(
        ["https://example.com/1", "https://example.com/2"],
        "darwin",
        noopExec
      );
      BunTest.expect(spawnMock).toHaveBeenCalledTimes(1);
      BunTest.expect(spawnMock).toHaveBeenLastCalledWith(
        "osascript",
        [
          "-e",
          'open location "https://example.com/1"\nopen location "https://example.com/2"',
        ],
        { stdio: "ignore", windowsHide: true }
      );
    }
  );

  BunTest.test("openURLs uses cmd start for all URLs on win32", async () => {
    const noopExec = BunTest.mock(() =>
      Promise.resolve({ exitCode: 1, stderr: "", stdout: "" })
    );

    await openURLs(
      ["https://example.com/1", "https://example.com/2"],
      "win32",
      noopExec
    );
    BunTest.expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      "cmd",
      ["/c", "start", "", "https://example.com/1"],
      { stdio: "ignore", windowsHide: true }
    );
    BunTest.expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "cmd",
      ["/c", "start", "", "https://example.com/2"],
      { stdio: "ignore", windowsHide: true }
    );
  });

  BunTest.test(
    "openURLs batches all URLs in single command on win32 with detected browser",
    async () => {
      const mockExec = BunTest.mock((cmd: string[]) => {
        if (cmd[0] === "powershell") {
          return Promise.resolve({
            exitCode: 0,
            stderr: "",
            stdout:
              "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
          });
        }
        if (cmd[0] === "cmd" && cmd[3] === "exist") {
          return Promise.resolve({
            exitCode: 0,
            stderr: "",
            stdout: "exists",
          });
        }
        return Promise.resolve({ exitCode: 1, stderr: "", stdout: "" });
      });

      await openURLs(
        ["https://example.com/1", "https://example.com/2"],
        "win32",
        mockExec
      );
      BunTest.expect(spawnMock).toHaveBeenCalledTimes(1);
      BunTest.expect(spawnMock).toHaveBeenLastCalledWith(
        "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        ["--new-window", "https://example.com/1", "https://example.com/2"],
        { stdio: "ignore", windowsHide: true }
      );
    }
  );

  BunTest.test(
    "openURLs batches all URLs in single command on linux with detected browser",
    async () => {
      const mockExec = BunTest.mock(() =>
        Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: "google-chrome.desktop\n",
        })
      );

      await openURLs(
        ["https://example.com/1", "https://example.com/2"],
        "linux",
        mockExec
      );
      BunTest.expect(spawnMock).toHaveBeenCalledTimes(1);
      BunTest.expect(spawnMock).toHaveBeenLastCalledWith(
        "google-chrome",
        ["--new-window", "https://example.com/1", "https://example.com/2"],
        { stdio: "ignore", windowsHide: true }
      );
    }
  );

  BunTest.test(
    "openURLs uses detected browser with --new-window on linux",
    async () => {
      const mockExec = BunTest.mock(() =>
        Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: "firefox.desktop\n",
        })
      );

      await openURLs(["https://example.com/3"], "linux", mockExec);
      BunTest.expect(spawnMock).toHaveBeenLastCalledWith(
        "firefox",
        ["--new-window", "https://example.com/3"],
        { stdio: "ignore", windowsHide: true }
      );
    }
  );

  BunTest.test(
    "openURLs falls back to xdg-open on linux when detection fails",
    async () => {
      const failExec = BunTest.mock(() =>
        Promise.resolve({ exitCode: 1, stderr: "", stdout: "" })
      );

      await openURLs(["https://example.com/3"], "linux", failExec);
      BunTest.expect(spawnMock).toHaveBeenLastCalledWith(
        "xdg-open",
        ["https://example.com/3"],
        { stdio: "ignore", windowsHide: true }
      );
    }
  );

  BunTest.test(
    "openURLs uses browser override when provided on win32",
    async () => {
      await openURLs(
        ["https://example.com/1", "https://example.com/2"],
        "win32",
        undefined,
        "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
      );
      BunTest.expect(spawnMock).toHaveBeenCalledTimes(1);
      BunTest.expect(spawnMock).toHaveBeenLastCalledWith(
        "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        ["--new-window", "https://example.com/1", "https://example.com/2"],
        { stdio: "ignore", windowsHide: true }
      );
    }
  );

  BunTest.test("does not display PRs when list is empty", async () => {
    await main(
      [tempDir],
      BunTest.mock((opts: { repo: string }) =>
        okResult(opts.repo, "no-changes")
      )
    );
    BunTest.expect(noteMock).not.toHaveBeenCalled();
  });

  BunTest.test("openURLBun spawns URL with Bun", () => {
    const spawnSpy = BunTest.spyOn(Bun, "spawn").mockReturnValue(
      {} as ReturnType<typeof Bun.spawn>
    );

    try {
      openURLBun(["open", "https://example.com"]);
      BunTest.expect(spawnSpy).toHaveBeenCalledWith(
        ["open", "https://example.com"],
        {
          stderr: "ignore",
          stdout: "ignore",
          windowsHide: true,
        }
      );
    } finally {
      spawnSpy.mockRestore();
    }
  });

  BunTest.test("openURLNodejs uses child_process spawn", async () => {
    await openURLNodejs(["echo", "BunTest.test"]);
    BunTest.expect(spawnMock).toHaveBeenCalledWith("echo", ["BunTest.test"], {
      stdio: "ignore",
      windowsHide: true,
    });
  });

  BunTest.test(
    "openURLs handles empty URL list without calling detectBrowser",
    async () => {
      const noopExec = BunTest.mock(() =>
        Promise.resolve({ exitCode: 1, stderr: "", stdout: "" })
      );
      await BunTest.expect(
        openURLs([], "darwin", noopExec)
      ).resolves.toBeUndefined();
      BunTest.expect(noopExec).not.toHaveBeenCalled();
    }
  );
});

BunTest.describe("detectBrowser", () => {
  BunTest.test(
    "returns null on macOS when Firefox is not default",
    async () => {
      const mockExec = BunTest.mock(() =>
        Promise.resolve({ exitCode: 1, stderr: "", stdout: "" })
      );
      const result = await detectBrowser("darwin", mockExec);
      BunTest.expect(result).toBeNull();
    }
  );

  BunTest.test(
    "detects Firefox on macOS when it is default browser",
    async () => {
      const mockExec = BunTest.mock(() =>
        Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout:
            '(\n    { LSHandlerURLScheme = https; LSHandlerRoleAll = "org.mozilla.firefox"; }\n)',
        })
      );
      const result = await detectBrowser("darwin", mockExec);
      BunTest.expect(result).toEqual({ browser: "firefox" });
    }
  );

  BunTest.test("detects Chrome on Windows with executable path", async () => {
    const mockExec = BunTest.mock((cmd: string[], _cwd: string) => {
      // PowerShell call for getting browser path
      if (cmd[0] === "powershell") {
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        });
      }
      if (cmd[0] === "cmd" && cmd[3] === "exist") {
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: "exists",
        });
      }
      return Promise.resolve({ exitCode: 1, stderr: "", stdout: "" });
    });
    BunTest.expect(await detectBrowser("win32", mockExec)).toEqual({
      browser: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    });
  });

  BunTest.test("detects Edge on Windows with executable path", async () => {
    const mockExec = BunTest.mock((cmd: string[], _cwd: string) => {
      if (cmd[0] === "powershell") {
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout:
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        });
      }
      if (cmd[0] === "cmd" && cmd[3] === "exist") {
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: "exists",
        });
      }
      return Promise.resolve({ exitCode: 1, stderr: "", stdout: "" });
    });
    BunTest.expect(await detectBrowser("win32", mockExec)).toEqual({
      browser:
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      path: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    });
  });

  BunTest.test("detects Firefox on Windows with executable path", async () => {
    const mockExec = BunTest.mock((cmd: string[], _cwd: string) => {
      if (cmd[0] === "powershell") {
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
        });
      }
      if (cmd[0] === "cmd" && cmd[3] === "exist") {
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: "exists",
        });
      }
      return Promise.resolve({ exitCode: 1, stderr: "", stdout: "" });
    });
    BunTest.expect(await detectBrowser("win32", mockExec)).toEqual({
      browser: "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
      path: "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
    });
  });

  BunTest.test("detects Brave on Windows with executable path", async () => {
    const mockExec = BunTest.mock((cmd: string[], _cwd: string) => {
      if (cmd[0] === "powershell") {
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout:
            "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        });
      }
      if (cmd[0] === "cmd" && cmd[3] === "exist") {
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: "exists",
        });
      }
      return Promise.resolve({ exitCode: 1, stderr: "", stdout: "" });
    });
    BunTest.expect(await detectBrowser("win32", mockExec)).toEqual({
      browser:
        "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      path: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    });
  });

  BunTest.test(
    "falls back to registry on Windows when PowerShell fails",
    async () => {
      const mockExec = BunTest.mock((cmd: string[], _cwd: string) => {
        if (cmd[0] === "powershell") {
          return Promise.resolve({
            exitCode: 1,
            stderr: "",
            stdout: "",
          });
        }
        if (cmd[0] === "reg" && cmd.some((c) => c.includes("UserChoice"))) {
          return Promise.resolve({
            exitCode: 0,
            stderr: "",
            stdout: "    ProgId    REG_SZ    BraveHTML",
          });
        }
        if (cmd[0] === "reg" && cmd.some((c) => c.includes("BraveHTML"))) {
          return Promise.resolve({
            exitCode: 0,
            stderr: "",
            stdout:
              '(Default)    REG_SZ    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" --single-argument %1',
          });
        }
        return Promise.resolve({ exitCode: 1, stderr: "", stdout: "" });
      });
      BunTest.expect(await detectBrowser("win32", mockExec)).toEqual({
        browser:
          "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        path: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      });
    }
  );

  BunTest.test("returns null on Windows when detection fails", async () => {
    const mockExec = BunTest.mock(() =>
      Promise.resolve({ exitCode: 1, stderr: "error", stdout: "" })
    );
    BunTest.expect(await detectBrowser("win32", mockExec)).toBeNull();
  });

  BunTest.test("detects Firefox on Linux", async () => {
    const mockExec = BunTest.mock(() =>
      Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: "firefox.desktop\n",
      })
    );
    BunTest.expect(await detectBrowser("linux", mockExec)).toEqual({
      browser: "firefox",
    });
  });

  BunTest.test("detects Chrome on Linux", async () => {
    const mockExec = BunTest.mock(() =>
      Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: "google-chrome.desktop\n",
      })
    );
    BunTest.expect(await detectBrowser("linux", mockExec)).toEqual({
      browser: "google-chrome",
    });
  });

  BunTest.test("returns null on Linux when xdg-settings fails", async () => {
    const mockExec = BunTest.mock(() =>
      Promise.resolve({ exitCode: 1, stderr: "error", stdout: "" })
    );
    BunTest.expect(await detectBrowser("linux", mockExec)).toBeNull();
  });

  BunTest.test("returns null on Linux for unknown desktop entry", async () => {
    const mockExec = BunTest.mock(() =>
      Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: "some-unknown-browser.desktop\n",
      })
    );
    BunTest.expect(await detectBrowser("linux", mockExec)).toBeNull();
  });

  BunTest.test("returns null when execFn throws", async () => {
    const mockExec = BunTest.mock(() =>
      Promise.reject(new Error("spawn failed"))
    );
    BunTest.expect(await detectBrowser("win32", mockExec)).toBeNull();
    BunTest.expect(await detectBrowser("linux", mockExec)).toBeNull();
  });
});
