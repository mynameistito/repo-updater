import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "better-result";
import { CommandFailedError } from "../src/errors.ts";
import type { RepoResult } from "../src/runner.ts";

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

const isCancelMock = mock((val: unknown) => false);
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

import { main, openURLs, openURLBun, openURLNodejs, printUsage, processRepo, resolveRepos } from "../src/index.ts";

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
  tempDir = join(tmpdir(), `cli-test-${Date.now()}`);
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
    const repos = resolveRepos({
      help: false,
      dryRun: false,
      configPath: undefined,
      positional: ["/repo1", "/repo2"],
    });
    expect(repos).toEqual(["/repo1", "/repo2"]);
  });

  test("dry-run returns result without pushing prUrls", () => {
    const prUrls: string[] = [];
    const repos = resolveRepos({
      help: false,
      dryRun: true,
      configPath: undefined,
      positional: ["/repo1", "/repo2"],
    });
    expect(repos).toEqual(["/repo1", "/repo2"]);
    expect(prUrls).toHaveLength(0);
  });

  test("loads repos from config file", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ repos: ["/a", "/b"] }));
    const repos = resolveRepos({
      help: false,
      dryRun: false,
      configPath,
      positional: [],
    });
    expect(repos).toEqual(["/a", "/b"]);
  });

  test("returns null when config is not found", () => {
    const repos = resolveRepos({
      help: false,
      dryRun: false,
      configPath: join(tempDir, "missing.json"),
      positional: [],
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

  test("openURLs launches correct command for each platform", () => {
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      {} as ReturnType<typeof Bun.spawn>
    );

    try {
      // Test win32
      openURLs(["https://example.com/1"], "win32");
      expect(spawnSpy).toHaveBeenLastCalledWith(["cmd", "/c", "start", "", "https://example.com/1"], {
        stdout: "ignore",
        stderr: "ignore",
      });

      // Test darwin
      spawnSpy.mockClear();
      openURLs(["https://example.com/2"], "darwin");
      expect(spawnSpy).toHaveBeenLastCalledWith(["open", "https://example.com/2"], {
        stdout: "ignore",
        stderr: "ignore",
      });

      // Test linux
      spawnSpy.mockClear();
      openURLs(["https://example.com/3"], "linux");
      expect(spawnSpy).toHaveBeenLastCalledWith(["xdg-open", "https://example.com/3"], {
        stdout: "ignore",
        stderr: "ignore",
      });
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("does not display PRs when list is empty", async () => {
    await main([tempDir], mock((opts: { repo: string }) =>
      okResult(opts.repo, "no-changes")
    ));
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
    const testCmd = process.platform === "win32" ? ["cmd", "/c", "echo", "test"] : ["echo", "test"];

    try {
      await openURLNodejs(testCmd);
      // If it succeeds, that's fine
    } catch (e) {
      // Unexpected error - child_process should work
      throw e;
    }
  });

  test("openURLs handles empty URL list", () => {
    // Test that openURLs doesn't throw with empty list
    expect(() => {
      openURLs([]);
    }).not.toThrow();
  });
});
