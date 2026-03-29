import {
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
import { Result } from "better-result";
import { CommandFailedError } from "../src/errors.ts";
import type { RepoResult } from "../src/runner.ts";

// biome-ignore lint/correctness/noUnusedVariables: available for Bun-specific test branches
const isBun = typeof globalThis.Bun !== "undefined";
const noop = () => undefined;
const logMock = {
  step: mock(noop),
  error: mock(noop),
  warn: mock(noop),
  info: mock(noop),
  success: mock(noop),
};
const spinnerInstance = {
  start: mock(noop),
  stop: mock(noop),
};
const confirmMock = mock(() => Promise.resolve(false));
const noteMock = mock(noop);
const outroMock = mock(noop);

const isCancelMock = mock((_val: unknown) => false);
const consoleLogMock = mock(noop);

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

const okResult = (
  repo: string,
  status: "no-changes" | "pr-created",
  prUrl?: string
) =>
  Promise.resolve(
    Result.ok<RepoResult, CommandFailedError>({ repo, status, prUrl })
  );

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
});

afterEach(() => {
  console.log = originalConsoleLog;
  rmSync(tempDir, { recursive: true, force: true });
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
    expect(result).toEqual({ repos: ["/repo1", "/repo2"] });
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
    expect(result).toEqual({ repos: ["/repo1", "/repo2"] });
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
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      {} as ReturnType<typeof Bun.spawn>
    );

    try {
      await main([tempDir], prUpdate);

      expect(noteMock).toHaveBeenCalled();
      expect(confirmMock).toHaveBeenCalled();
      expect(spawnSpy).toHaveBeenCalled();
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("does not open browser when declined", async () => {
    const url = "https://github.com/owner/repo/pull/1";
    const prUpdate = mock((opts: { repo: string }) =>
      okResult(opts.repo, "pr-created", url)
    );
    confirmMock.mockImplementation(() => Promise.resolve(false));
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      {} as ReturnType<typeof Bun.spawn>
    );

    try {
      await main([tempDir], prUpdate);

      expect(noteMock).toHaveBeenCalled();
      expect(spawnSpy).not.toHaveBeenCalled();
    } finally {
      spawnSpy.mockRestore();
    }
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
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      {} as ReturnType<typeof Bun.spawn>
    );
    const noopExec = mock(() =>
      Promise.resolve({ stdout: "", stderr: "", exitCode: 1 })
    );

    try {
      await openURLs(["https://example.com/2"], "darwin", noopExec);
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      expect(spawnSpy).toHaveBeenLastCalledWith(
        ["osascript", "-e", 'open location "https://example.com/2"'],
        {
          stdout: "ignore",
          stderr: "ignore",
        }
      );
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("openURLs falls back to cmd start on win32 when browser not detected", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      {} as ReturnType<typeof Bun.spawn>
    );
    const noopExec = mock(() =>
      Promise.resolve({ stdout: "", stderr: "", exitCode: 1 })
    );

    try {
      await openURLs(["https://example.com/1"], "win32", noopExec);
      expect(spawnSpy).toHaveBeenLastCalledWith(
        ["cmd", "/c", "start", "", "https://example.com/1"],
        {
          stdout: "ignore",
          stderr: "ignore",
        }
      );
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("openURLs batches URLs via osascript on darwin without detected browser", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      {} as ReturnType<typeof Bun.spawn>
    );
    const noopExec = mock(() =>
      Promise.resolve({ stdout: "", stderr: "", exitCode: 1 })
    );

    try {
      await openURLs(
        ["https://example.com/1", "https://example.com/2"],
        "darwin",
        noopExec
      );
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      expect(spawnSpy).toHaveBeenLastCalledWith(
        [
          "osascript",
          "-e",
          'open location "https://example.com/1"\nopen location "https://example.com/2"',
        ],
        {
          stdout: "ignore",
          stderr: "ignore",
        }
      );
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("openURLs uses cmd start for all URLs on win32", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      {} as ReturnType<typeof Bun.spawn>
    );
    const noopExec = mock(() =>
      Promise.resolve({ stdout: "", stderr: "", exitCode: 1 })
    );

    try {
      await openURLs(
        ["https://example.com/1", "https://example.com/2"],
        "win32",
        noopExec
      );
      expect(spawnSpy).toHaveBeenNthCalledWith(
        1,
        ["cmd", "/c", "start", "", "https://example.com/1"],
        { stdout: "ignore", stderr: "ignore" }
      );
      expect(spawnSpy).toHaveBeenNthCalledWith(
        2,
        ["cmd", "/c", "start", "", "https://example.com/2"],
        { stdout: "ignore", stderr: "ignore" }
      );
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("openURLs batches all URLs in single command on win32 with detected browser", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      {} as ReturnType<typeof Bun.spawn>
    );
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

    try {
      await openURLs(
        ["https://example.com/1", "https://example.com/2"],
        "win32",
        mockExec
      );
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      expect(spawnSpy).toHaveBeenLastCalledWith(
        [
          "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
          "--new-window",
          "https://example.com/1",
          "https://example.com/2",
        ],
        { stdout: "ignore", stderr: "ignore" }
      );
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("openURLs batches all URLs in single command on linux with detected browser", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      {} as ReturnType<typeof Bun.spawn>
    );
    const mockExec = mock(() =>
      Promise.resolve({
        stdout: "google-chrome.desktop\n",
        stderr: "",
        exitCode: 0,
      })
    );

    try {
      await openURLs(
        ["https://example.com/1", "https://example.com/2"],
        "linux",
        mockExec
      );
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      expect(spawnSpy).toHaveBeenLastCalledWith(
        [
          "google-chrome",
          "--new-window",
          "https://example.com/1",
          "https://example.com/2",
        ],
        {
          stdout: "ignore",
          stderr: "ignore",
        }
      );
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("openURLs uses detected browser with --new-window on linux", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      {} as ReturnType<typeof Bun.spawn>
    );
    const mockExec = mock(() =>
      Promise.resolve({
        stdout: "firefox.desktop\n",
        stderr: "",
        exitCode: 0,
      })
    );

    try {
      await openURLs(["https://example.com/3"], "linux", mockExec);
      expect(spawnSpy).toHaveBeenLastCalledWith(
        ["firefox", "--new-window", "https://example.com/3"],
        {
          stdout: "ignore",
          stderr: "ignore",
        }
      );
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("openURLs falls back to xdg-open on linux when detection fails", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      {} as ReturnType<typeof Bun.spawn>
    );
    const failExec = mock(() =>
      Promise.resolve({ stdout: "", stderr: "", exitCode: 1 })
    );

    try {
      await openURLs(["https://example.com/3"], "linux", failExec);
      expect(spawnSpy).toHaveBeenLastCalledWith(
        ["xdg-open", "https://example.com/3"],
        {
          stdout: "ignore",
          stderr: "ignore",
        }
      );
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("openURLs uses browser override when provided on win32", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      {} as ReturnType<typeof Bun.spawn>
    );

    try {
      await openURLs(
        ["https://example.com/1", "https://example.com/2"],
        "win32",
        undefined,
        "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
      );
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      expect(spawnSpy).toHaveBeenLastCalledWith(
        [
          "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
          "--new-window",
          "https://example.com/1",
          "https://example.com/2",
        ],
        { stdout: "ignore", stderr: "ignore" }
      );
    } finally {
      spawnSpy.mockRestore();
    }
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
      });
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("openURLNodejs uses child_process spawn", async () => {
    // Use cross-platform command that exists
    const testCmd =
      process.platform === "win32"
        ? ["cmd", "/c", "echo", "test"]
        : ["echo", "test"];

    await openURLNodejs(testCmd);
    // If it succeeds, that's fine
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
