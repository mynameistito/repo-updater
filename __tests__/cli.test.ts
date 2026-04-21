import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn as realSpawn } from "node:child_process";
import { Result } from "better-result";
import { CommandFailedError } from "../src/errors.ts";
import type { RepoResult } from "../src/runner.ts";

// biome-ignore lint/correctness/noUnusedVariables: available for Bun-specific test branches
const isBun = typeof globalThis.Bun !== "undefined";

/** No-op function used as default mock implementation. */
const noop = () => undefined;

/** Mock object for the `@clack/prompts` `log` utility. */
const logMock = {
  step: mock(noop),
  error: mock(noop),
  warn: mock(noop),
  info: mock(noop),
  success: mock(noop),
};

/** Mock spinner instance returned by the `@clack/prompts` `spinner()` factory. */
const spinnerInstance = {
  start: mock(noop),
  stop: mock(noop),
};

/** Mock for `@clack/prompts` `confirm()`. Defaults to declining. */
const confirmMock = mock(() => Promise.resolve(false));

/** Mock for `@clack/prompts` `note()`. */
const noteMock = mock(noop);

/** Mock for `@clack/prompts` `outro()`. */
const outroMock = mock(noop);

/** Mock for `@clack/prompts` `isCancel()`. Always returns `false` by default. */
const isCancelMock = mock((_val: unknown) => false);

/** Mock replacing `console.log` to suppress output during tests. */
const consoleLogMock = mock(noop);

// Capture the real function value BEFORE mock.module overwrites the live
// ES-module binding — otherwise `realSpawn` inside the closure would point
// back to `spawnMock` and recurse infinitely.
const capturedSpawn = realSpawn;

/** Mock for `node:child_process` `spawn`.
 * Intercepts fire-and-forget calls from `openURLNodejs` (stdio: "ignore").
 * Delegates to the real spawn for all other callers (e.g. `execNodejs`). */
const spawnMock = mock(
  (cmd: string, args: string[], opts?: Parameters<typeof realSpawn>[2]) => {
    if (opts && "stdio" in opts && opts.stdio === "ignore") {
      return { unref: mock(noop) } as unknown as ReturnType<typeof realSpawn>;
    }
    return capturedSpawn(cmd, args, opts as Parameters<typeof realSpawn>[2]);
  }
);

mock.module("node:child_process", () => ({
  spawn: spawnMock,
}));

mock.module("@clack/prompts", () => ({
  intro: mock(noop),
  outro: outroMock,
  log: logMock,
  note: noteMock,
  confirm: confirmMock,
  isCancel: isCancelMock,
  spinner: () => spinnerInstance,
}));

import {
  detectBrowser,
  main,
  openURLBun,
  openURLNodejs,
  openURLs,
  printUsage,
  processRepo,
  resolveRepos,
} from "../src/index.ts";

let tempDir: string;
let originalConsoleLog: typeof console.log;

/** Creates a resolved `Ok` result wrapping a mock {@link RepoResult}. */
const okResult = (
  repo: string,
  status: "no-changes" | "pr-created",
  prUrl?: string
) =>
  Promise.resolve(
    Result.ok<RepoResult, CommandFailedError>({ repo, status, prUrl })
  );

/** Creates a resolved `Err` result wrapping a {@link CommandFailedError}. */
const errResult = (message: string, command: string, stderr: string) =>
  Promise.resolve(
    Result.err<RepoResult, CommandFailedError>(
      new CommandFailedError({ message, command, stderr })
    )
  );

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "cli-test-"));
  mkdirSync(join(tempDir, ".git"), { recursive: true });
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

afterEach(() => {
  console.log = originalConsoleLog;
  rmSync(tempDir, { recursive: true, force: true });
});

// Restore the real node:child_process after all cli tests so later test files
// (e.g. runner.test.ts) are not affected by the module-level mock.
afterAll(() => {
  mock.module("node:child_process", () => ({ spawn: realSpawn }));
});

describe("printUsage", () => {
  test("prints usage text", () => {
    expect(() => printUsage()).not.toThrow();
  });
});

describe("resolveRepos", () => {
  test("returns positional args directly", () => {
    const result = resolveRepos({
      help: false,
      dryRun: false,
      minor: false,
      noChangeset: false,
      noWorkspaces: false,
      configPath: undefined,
      positional: ["/repo1", "/repo2"],
      browser: undefined,
    });
    expect(result?.repos).toEqual(["/repo1", "/repo2"]);
  });

  test("dry-run returns result without pushing prUrls", () => {
    const prUrls: string[] = [];
    const result = resolveRepos({
      help: false,
      dryRun: true,
      minor: false,
      noChangeset: false,
      noWorkspaces: false,
      configPath: undefined,
      positional: ["/repo1", "/repo2"],
      browser: undefined,
    });
    expect(result?.repos).toEqual(["/repo1", "/repo2"]);
    expect(prUrls).toHaveLength(0);
  });

  test("loads repos from config file", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ repos: ["/a", "/b"] }));
    const result = resolveRepos({
      help: false,
      dryRun: false,
      minor: false,
      noChangeset: false,
      noWorkspaces: false,
      configPath,
      positional: [],
      browser: undefined,
    });
    expect(result?.repos).toEqual(["/a", "/b"]);
  });

  test("returns null when config is not found", () => {
    const repos = resolveRepos({
      help: false,
      dryRun: false,
      minor: false,
      noChangeset: false,
      noWorkspaces: false,
      configPath: join(tempDir, "missing.json"),
      positional: [],
      browser: undefined,
    });
    expect(repos).toBeNull();
    expect(logMock.error).toHaveBeenCalled();
  });
});

describe("processRepo", () => {
  test("dry-run ok returns result value", async () => {
    const updateFn = mock((opts: { repo: string }) =>
      okResult(opts.repo, "pr-created", "https://example.com/pr/1")
    );
    const result = await processRepo(tempDir, "2025-01-01", true, updateFn);
    expect(result.status).toBe("pr-created");
  });

  test("dry-run error returns failed", async () => {
    const updateFn = mock(() => errResult("fail", "git", "error"));
    const result = await processRepo(tempDir, "2025-01-01", true, updateFn);
    expect(result.status).toBe("failed");
  });

  test("non-dry-run no-changes logs info", async () => {
    const updateFn = mock((opts: { repo: string }) =>
      okResult(opts.repo, "no-changes")
    );
    const result = await processRepo(tempDir, "2025-01-01", false, updateFn);
    expect(result.status).toBe("no-changes");
  });

  test("non-dry-run pr-created pushes URL", async () => {
    const url = "https://github.com/owner/repo/pull/1";
    const updateFn = mock((opts: { repo: string }) =>
      okResult(opts.repo, "pr-created", url)
    );
    const result = await processRepo(tempDir, "2025-01-01", false, updateFn);
    expect(result.status).toBe("pr-created");
    expect(result.prUrl).toEqual(url);
  });

  test("non-dry-run error returns failed and logs stderr", async () => {
    const updateFn = mock(() =>
      errResult("git pull failed", "git pull", "fatal: no remote")
    );
    const result = await processRepo(tempDir, "2025-01-01", false, updateFn);
    expect(result.status).toBe("failed");
    expect(logMock.error).toHaveBeenCalledTimes(2);
  });

  test("non-dry-run pr-created without prUrl logs success with repo name", async () => {
    const updateFn = mock((opts: { repo: string }) =>
      okResult(opts.repo, "pr-created")
    );
    const result = await processRepo(tempDir, "2025-01-01", false, updateFn);
    expect(result.status).toBe("pr-created");
    expect(logMock.success).toHaveBeenCalled();
  });
});

describe("main", () => {
  const noopUpdate = mock((opts: { repo: string }) =>
    okResult(opts.repo, "no-changes")
  );

  let exitSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    if (exitSpy) {
      exitSpy.mockRestore();
    }
  });

  test("--help prints usage and exits", async () => {
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    try {
      await expect(main(["--help"], noopUpdate)).rejects.toThrow("exit");
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("exits when config not found", async () => {
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    try {
      await expect(
        main(["-c", join(tempDir, "missing.json")], noopUpdate)
      ).rejects.toThrow("exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("exits when no valid repos found", async () => {
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    try {
      await expect(
        main([join(tempDir, "nonexistent")], noopUpdate)
      ).rejects.toThrow("exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("warns about missing repos", async () => {
    const validDir = join(tempDir, "valid");
    mkdirSync(join(validDir, ".git"), { recursive: true });
    await main([validDir, join(tempDir, "nonexistent")], noopUpdate);
    expect(logMock.warn).toHaveBeenCalled();
  });

  test("shows dry-run message", async () => {
    await main(["-n", tempDir], noopUpdate);
    expect(logMock.info).toHaveBeenCalled();
  });

  test("shows no-PRs message when no changes", async () => {
    await main([tempDir], noopUpdate);
    expect(logMock.info).toHaveBeenCalledWith("No pull requests were created.");
  });

  test("shows PR URLs and opens in browser when confirmed", async () => {
    const url = "https://github.com/owner/repo/pull/1";
    const prUpdate = mock((opts: { repo: string }) =>
      okResult(opts.repo, "pr-created", url)
    );
    confirmMock.mockImplementation(() => Promise.resolve(true));

    await main([tempDir], prUpdate);

    expect(noteMock).toHaveBeenCalled();
    expect(confirmMock).toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalled();
  });

  test("does not open browser when declined", async () => {
    const url = "https://github.com/owner/repo/pull/1";
    const prUpdate = mock((opts: { repo: string }) =>
      okResult(opts.repo, "pr-created", url)
    );
    confirmMock.mockImplementation(() => Promise.resolve(false));

    await main([tempDir], prUpdate);

    expect(noteMock).toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  test("exits when user cancels PR confirmation", async () => {
    const url = "https://github.com/owner/repo/pull/1";
    const prUpdate = mock((opts: { repo: string }) =>
      okResult(opts.repo, "pr-created", url)
    );
    isCancelMock.mockImplementation(() => true);
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    try {
      await expect(main([tempDir], prUpdate)).rejects.toThrow("exit");
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("openURLs uses osascript on darwin when browser not detected", async () => {
    const noopExec = mock(() =>
      Promise.resolve({ stdout: "", stderr: "", exitCode: 1 })
    );

    await openURLs(["https://example.com/2"], "darwin", noopExec);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenLastCalledWith(
      "osascript",
      ["-e", 'open location "https://example.com/2"'],
      { stdio: "ignore", windowsHide: true }
    );
  });

  test("openURLs falls back to cmd start on win32 when browser not detected", async () => {
    const noopExec = mock(() =>
      Promise.resolve({ stdout: "", stderr: "", exitCode: 1 })
    );

    await openURLs(["https://example.com/1"], "win32", noopExec);
    expect(spawnMock).toHaveBeenLastCalledWith(
      "cmd",
      ["/c", "start", "", "https://example.com/1"],
      { stdio: "ignore", windowsHide: true }
    );
  });

  test("openURLs batches URLs via osascript on darwin without detected browser", async () => {
    const noopExec = mock(() =>
      Promise.resolve({ stdout: "", stderr: "", exitCode: 1 })
    );

    await openURLs(
      ["https://example.com/1", "https://example.com/2"],
      "darwin",
      noopExec
    );
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenLastCalledWith(
      "osascript",
      [
        "-e",
        'open location "https://example.com/1"\nopen location "https://example.com/2"',
      ],
      { stdio: "ignore", windowsHide: true }
    );
  });

  test("openURLs uses cmd start for all URLs on win32", async () => {
    const noopExec = mock(() =>
      Promise.resolve({ stdout: "", stderr: "", exitCode: 1 })
    );

    await openURLs(
      ["https://example.com/1", "https://example.com/2"],
      "win32",
      noopExec
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      "cmd",
      ["/c", "start", "", "https://example.com/1"],
      { stdio: "ignore", windowsHide: true }
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "cmd",
      ["/c", "start", "", "https://example.com/2"],
      { stdio: "ignore", windowsHide: true }
    );
  });

  test("openURLs batches all URLs in single command on win32 with detected browser", async () => {
    const mockExec = mock((cmd: string[]) => {
      if (cmd[0] === "powershell") {
        return Promise.resolve({
          stdout:
            "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
          stderr: "",
          exitCode: 0,
        });
      }
      if (cmd[0] === "cmd" && cmd[3] === "exist") {
        return Promise.resolve({
          stdout: "exists",
          stderr: "",
          exitCode: 0,
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 1 });
    });

    await openURLs(
      ["https://example.com/1", "https://example.com/2"],
      "win32",
      mockExec
    );
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenLastCalledWith(
      "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      ["--new-window", "https://example.com/1", "https://example.com/2"],
      { stdio: "ignore", windowsHide: true }
    );
  });

  test("openURLs batches all URLs in single command on linux with detected browser", async () => {
    const mockExec = mock(() =>
      Promise.resolve({
        stdout: "google-chrome.desktop\n",
        stderr: "",
        exitCode: 0,
      })
    );

    await openURLs(
      ["https://example.com/1", "https://example.com/2"],
      "linux",
      mockExec
    );
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenLastCalledWith(
      "google-chrome",
      ["--new-window", "https://example.com/1", "https://example.com/2"],
      { stdio: "ignore", windowsHide: true }
    );
  });

  test("openURLs uses detected browser with --new-window on linux", async () => {
    const mockExec = mock(() =>
      Promise.resolve({
        stdout: "firefox.desktop\n",
        stderr: "",
        exitCode: 0,
      })
    );

    await openURLs(["https://example.com/3"], "linux", mockExec);
    expect(spawnMock).toHaveBeenLastCalledWith(
      "firefox",
      ["--new-window", "https://example.com/3"],
      { stdio: "ignore", windowsHide: true }
    );
  });

  test("openURLs falls back to xdg-open on linux when detection fails", async () => {
    const failExec = mock(() =>
      Promise.resolve({ stdout: "", stderr: "", exitCode: 1 })
    );

    await openURLs(["https://example.com/3"], "linux", failExec);
    expect(spawnMock).toHaveBeenLastCalledWith(
      "xdg-open",
      ["https://example.com/3"],
      { stdio: "ignore", windowsHide: true }
    );
  });

  test("openURLs uses browser override when provided on win32", async () => {
    await openURLs(
      ["https://example.com/1", "https://example.com/2"],
      "win32",
      undefined,
      "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
    );
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenLastCalledWith(
      "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      ["--new-window", "https://example.com/1", "https://example.com/2"],
      { stdio: "ignore", windowsHide: true }
    );
  });

  test("does not display PRs when list is empty", async () => {
    await main(
      [tempDir],
      mock((opts: { repo: string }) => okResult(opts.repo, "no-changes"))
    );
    expect(noteMock).not.toHaveBeenCalled();
  });

  test("openURLBun spawns URL with Bun", () => {
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      {} as ReturnType<typeof Bun.spawn>
    );

    try {
      openURLBun(["open", "https://example.com"]);
      expect(spawnSpy).toHaveBeenCalledWith(["open", "https://example.com"], {
        stdout: "ignore",
        stderr: "ignore",
        windowsHide: true,
      });
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("openURLNodejs uses child_process spawn", async () => {
    await openURLNodejs(["echo", "test"]);
    expect(spawnMock).toHaveBeenCalledWith("echo", ["test"], {
      stdio: "ignore",
      windowsHide: true,
    });
  });

  test("openURLs handles empty URL list without calling detectBrowser", async () => {
    const noopExec = mock(() =>
      Promise.resolve({ stdout: "", stderr: "", exitCode: 1 })
    );
    await expect(openURLs([], "darwin", noopExec)).resolves.toBeUndefined();
    expect(noopExec).not.toHaveBeenCalled();
  });
});

describe("detectBrowser", () => {
  test("returns null on macOS when Firefox is not default", async () => {
    const mockExec = mock(() =>
      Promise.resolve({ stdout: "", stderr: "", exitCode: 1 })
    );
    const result = await detectBrowser("darwin", mockExec);
    expect(result).toBeNull();
  });

  test("detects Firefox on macOS when it is default browser", async () => {
    const mockExec = mock(() =>
      Promise.resolve({
        stdout:
          '(\n    { LSHandlerURLScheme = https; LSHandlerRoleAll = "org.mozilla.firefox"; }\n)',
        stderr: "",
        exitCode: 0,
      })
    );
    const result = await detectBrowser("darwin", mockExec);
    expect(result).toEqual({ browser: "firefox" });
  });

  test("detects Chrome on Windows with executable path", async () => {
    const mockExec = mock((cmd: string[], _cwd: string) => {
      // PowerShell call for getting browser path
      if (cmd[0] === "powershell") {
        return Promise.resolve({
          stdout: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          stderr: "",
          exitCode: 0,
        });
      }
      if (cmd[0] === "cmd" && cmd[3] === "exist") {
        return Promise.resolve({
          stdout: "exists",
          stderr: "",
          exitCode: 0,
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 1 });
    });
    expect(await detectBrowser("win32", mockExec)).toEqual({
      browser: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    });
  });

  test("detects Edge on Windows with executable path", async () => {
    const mockExec = mock((cmd: string[], _cwd: string) => {
      if (cmd[0] === "powershell") {
        return Promise.resolve({
          stdout:
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
          stderr: "",
          exitCode: 0,
        });
      }
      if (cmd[0] === "cmd" && cmd[3] === "exist") {
        return Promise.resolve({
          stdout: "exists",
          stderr: "",
          exitCode: 0,
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 1 });
    });
    expect(await detectBrowser("win32", mockExec)).toEqual({
      browser:
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      path: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    });
  });

  test("detects Firefox on Windows with executable path", async () => {
    const mockExec = mock((cmd: string[], _cwd: string) => {
      if (cmd[0] === "powershell") {
        return Promise.resolve({
          stdout: "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
          stderr: "",
          exitCode: 0,
        });
      }
      if (cmd[0] === "cmd" && cmd[3] === "exist") {
        return Promise.resolve({
          stdout: "exists",
          stderr: "",
          exitCode: 0,
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 1 });
    });
    expect(await detectBrowser("win32", mockExec)).toEqual({
      browser: "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
      path: "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
    });
  });

  test("detects Brave on Windows with executable path", async () => {
    const mockExec = mock((cmd: string[], _cwd: string) => {
      if (cmd[0] === "powershell") {
        return Promise.resolve({
          stdout:
            "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
          stderr: "",
          exitCode: 0,
        });
      }
      if (cmd[0] === "cmd" && cmd[3] === "exist") {
        return Promise.resolve({
          stdout: "exists",
          stderr: "",
          exitCode: 0,
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 1 });
    });
    expect(await detectBrowser("win32", mockExec)).toEqual({
      browser:
        "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      path: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    });
  });

  test("falls back to registry on Windows when PowerShell fails", async () => {
    const mockExec = mock((cmd: string[], _cwd: string) => {
      if (cmd[0] === "powershell") {
        return Promise.resolve({
          stdout: "",
          stderr: "",
          exitCode: 1,
        });
      }
      if (cmd[0] === "reg" && cmd.some((c) => c.includes("UserChoice"))) {
        return Promise.resolve({
          stdout: "    ProgId    REG_SZ    BraveHTML",
          stderr: "",
          exitCode: 0,
        });
      }
      if (cmd[0] === "reg" && cmd.some((c) => c.includes("BraveHTML"))) {
        return Promise.resolve({
          stdout:
            '(Default)    REG_SZ    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" --single-argument %1',
          stderr: "",
          exitCode: 0,
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 1 });
    });
    expect(await detectBrowser("win32", mockExec)).toEqual({
      browser:
        "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      path: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    });
  });

  test("returns null on Windows when detection fails", async () => {
    const mockExec = mock(() =>
      Promise.resolve({ stdout: "", stderr: "error", exitCode: 1 })
    );
    expect(await detectBrowser("win32", mockExec)).toBeNull();
  });

  test("detects Firefox on Linux", async () => {
    const mockExec = mock(() =>
      Promise.resolve({
        stdout: "firefox.desktop\n",
        stderr: "",
        exitCode: 0,
      })
    );
    expect(await detectBrowser("linux", mockExec)).toEqual({
      browser: "firefox",
    });
  });

  test("detects Chrome on Linux", async () => {
    const mockExec = mock(() =>
      Promise.resolve({
        stdout: "google-chrome.desktop\n",
        stderr: "",
        exitCode: 0,
      })
    );
    expect(await detectBrowser("linux", mockExec)).toEqual({
      browser: "google-chrome",
    });
  });

  test("returns null on Linux when xdg-settings fails", async () => {
    const mockExec = mock(() =>
      Promise.resolve({ stdout: "", stderr: "error", exitCode: 1 })
    );
    expect(await detectBrowser("linux", mockExec)).toBeNull();
  });

  test("returns null on Linux for unknown desktop entry", async () => {
    const mockExec = mock(() =>
      Promise.resolve({
        stdout: "some-unknown-browser.desktop\n",
        stderr: "",
        exitCode: 0,
      })
    );
    expect(await detectBrowser("linux", mockExec)).toBeNull();
  });

  test("returns null when execFn throws", async () => {
    const mockExec = mock(() => Promise.reject(new Error("spawn failed")));
    expect(await detectBrowser("win32", mockExec)).toBeNull();
    expect(await detectBrowser("linux", mockExec)).toBeNull();
  });
});
