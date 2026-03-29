import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findConfigPath,
  loadConfig,
  saveBrowserToConfig,
  validateRepos,
} from "../src/config.ts";

// biome-ignore lint/correctness/noUnusedVariables: available for Bun-specific test branches
const isBun = typeof globalThis.Bun !== "undefined";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "repo-updater-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  test("loads valid config from explicit path", () => {
    const configPath = join(tempDir, "config.json");
    const config = { repos: ["/path/to/repo1", "/path/to/repo2"] };
    writeFileSync(configPath, JSON.stringify(config));

    const result = loadConfig(configPath);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.repos).toEqual(["/path/to/repo1", "/path/to/repo2"]);
    }
  });

  test("returns ConfigNotFoundError for missing file", () => {
    const result = loadConfig(join(tempDir, "nonexistent.json"));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigNotFoundError");
    }
  });

  test("returns ConfigParseError for invalid JSON", () => {
    const configPath = join(tempDir, "bad.json");
    writeFileSync(configPath, "{not valid json");

    const result = loadConfig(configPath);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigParseError");
    }
  });

  test("searches default locations when no path given", () => {
    // Create a config in tempDir to verify it can find it via search
    const configPath = join(tempDir, "repo-updater.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: ["/test/repo"] }));

    const oldCwd = process.cwd();
    try {
      process.chdir(tempDir);
      const result = loadConfig();
      // Should succeed because we created a config in tempDir
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.repos).toBeInstanceOf(Array);
        expect(result.value.repos).toEqual(["/test/repo"]);
      }
    } finally {
      process.chdir(oldCwd);
    }
  });

  test("returns ConfigParseError when repos key is missing", () => {
    const configPath = join(tempDir, "empty.json");
    writeFileSync(configPath, JSON.stringify({}));

    const result = loadConfig(configPath);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigParseError");
    }
  });

  test("loads config with browser override", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        repos: ["/path/to/repo1"],
        browser:
          "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      })
    );

    const result = loadConfig(configPath);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.browser).toBe(
        "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
      );
    }
  });

  test("returns ConfigParseError when browser is not a string", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ repos: ["/path"], browser: 42 })
    );

    const result = loadConfig(configPath);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigParseError");
    }
  });

  test("returns undefined browser when not specified", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ repos: ["/path"] }));

    const result = loadConfig(configPath);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.browser).toBeUndefined();
    }
  });
});

describe("findConfigPath", () => {
  test("returns path when config file exists", () => {
    const configPath = join(tempDir, "repo-updater.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [] }));

    const oldCwd = process.cwd();
    try {
      process.chdir(tempDir);
      const found = findConfigPath();
      expect(found).toBe(configPath);
    } finally {
      process.chdir(oldCwd);
    }
  });

  test("returns explicit path when it exists", () => {
    const configPath = join(tempDir, "custom.json");
    writeFileSync(configPath, JSON.stringify({ repos: [] }));
    expect(findConfigPath(configPath)).toBe(configPath);
  });

  test("returns null when no config file exists", () => {
    expect(findConfigPath(join(tempDir, "nonexistent.json"))).toBeNull();
  });
});

describe("saveBrowserToConfig", () => {
  test("saves browser to existing config file", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ repos: ["/test"] }));

    const result = saveBrowserToConfig("chromium", configPath);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(configPath);
    }

    const updated = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(updated.browser).toBe("chromium");
    expect(updated.repos).toEqual(["/test"]);
  });

  test("returns error when config file not found", () => {
    const result = saveBrowserToConfig(
      "chromium",
      join(tempDir, "missing.json")
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigNotFoundError");
    }
  });

  test("returns error when config file has invalid JSON", () => {
    const configPath = join(tempDir, "bad.json");
    writeFileSync(configPath, "{not valid json");

    const result = saveBrowserToConfig("chromium", configPath);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigParseError");
    }
  });
});

describe("validateRepos", () => {
  test("splits paths into valid, missing, and non-git directories", () => {
    const validGitDir = join(tempDir, "git-repo");
    mkdirSync(validGitDir);
    mkdirSync(join(validGitDir, ".git"));

    const notGitDir = join(tempDir, "regular-dir");
    mkdirSync(notGitDir);

    const fakePath = join(tempDir, "does-not-exist");

    const { valid, missing, notGit } = validateRepos([
      validGitDir,
      notGitDir,
      fakePath,
    ]);
    expect(valid).toEqual([validGitDir]);
    expect(notGit).toEqual([notGitDir]);
    expect(missing).toEqual([fakePath]);
  });
});
