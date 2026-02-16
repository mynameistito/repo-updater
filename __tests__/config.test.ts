import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, validateRepos } from "../src/config.ts";

let tempDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `repo-updater-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
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
});

describe("validateRepos", () => {
  test("splits paths into valid and missing", () => {
    const validDir = join(tempDir, "exists");
    mkdirSync(validDir);
    const fakePath = join(tempDir, "does-not-exist");

    const { valid, missing } = validateRepos([validDir, fakePath]);
    expect(valid).toEqual([validDir]);
    expect(missing).toEqual([fakePath]);
  });
});
