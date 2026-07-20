import * as BunTest from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  findConfigPath,
  loadConfig,
  saveBrowserToConfig,
  validateRepos,
} from "../src/config.ts";

let tempDir: string;

BunTest.beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "repo-updater-BunTest.test-"));
});

BunTest.afterEach(() => {
  rmSync(tempDir, { force: true, recursive: true });
});

BunTest.describe("loadConfig", () => {
  BunTest.test("loads valid config from explicit path", () => {
    const configPath = path.join(tempDir, "config.json");
    const config = { repos: ["/path/to/repo1", "/path/to/repo2"] };
    writeFileSync(configPath, JSON.stringify(config));

    const result = loadConfig(configPath);
    BunTest.expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      BunTest.expect(result.value.repos).toEqual([
        "/path/to/repo1",
        "/path/to/repo2",
      ]);
    }
  });

  BunTest.test("returns ConfigNotFoundError for missing file", () => {
    const result = loadConfig(path.join(tempDir, "nonexistent.json"));
    BunTest.expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      BunTest.expect(result.error._tag).toBe("ConfigNotFoundError");
    }
  });

  BunTest.test("returns ConfigParseError for invalid JSON", () => {
    const configPath = path.join(tempDir, "bad.json");
    writeFileSync(configPath, "{not valid json");

    const result = loadConfig(configPath);
    BunTest.expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      BunTest.expect(result.error._tag).toBe("ConfigParseError");
    }
  });

  BunTest.test("searches default locations when no path given", () => {
    // Create a config in tempDir to verify it can find it via search
    const configPath = path.join(tempDir, "repo-updater.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ repos: ["/BunTest.test/repo"] })
    );

    const oldCwd = process.cwd();
    try {
      process.chdir(tempDir);
      const result = loadConfig();
      // Should succeed because we created a config in tempDir
      BunTest.expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        BunTest.expect(result.value.repos).toBeInstanceOf(Array);
        BunTest.expect(result.value.repos).toEqual(["/BunTest.test/repo"]);
      }
    } finally {
      process.chdir(oldCwd);
    }
  });

  BunTest.test("returns ConfigParseError when repos key is missing", () => {
    const configPath = path.join(tempDir, "empty.json");
    writeFileSync(configPath, JSON.stringify({}));

    const result = loadConfig(configPath);
    BunTest.expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      BunTest.expect(result.error._tag).toBe("ConfigParseError");
    }
  });

  BunTest.test("loads config with browser override", () => {
    const configPath = path.join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        browser:
          "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        repos: ["/path/to/repo1"],
      })
    );

    const result = loadConfig(configPath);
    BunTest.expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      BunTest.expect(result.value.browser).toBe(
        "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
      );
    }
  });

  BunTest.test("returns ConfigParseError when browser is not a string", () => {
    const configPath = path.join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ browser: 42, repos: ["/path"] })
    );

    const result = loadConfig(configPath);
    BunTest.expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      BunTest.expect(result.error._tag).toBe("ConfigParseError");
    }
  });

  BunTest.test("returns undefined browser when not specified", () => {
    const configPath = path.join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ repos: ["/path"] }));

    const result = loadConfig(configPath);
    BunTest.expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      BunTest.expect(result.value.browser).toBeUndefined();
    }
  });
});

BunTest.describe("findConfigPath", () => {
  BunTest.test("returns path when config file exists", () => {
    const configPath = path.join(tempDir, "repo-updater.config.json");
    writeFileSync(configPath, JSON.stringify({ repos: [] }));

    const oldCwd = process.cwd();
    try {
      process.chdir(tempDir);
      const found = findConfigPath();
      BunTest.expect(found).toBe(configPath);
    } finally {
      process.chdir(oldCwd);
    }
  });

  BunTest.test("returns explicit path when it exists", () => {
    const configPath = path.join(tempDir, "custom.json");
    writeFileSync(configPath, JSON.stringify({ repos: [] }));
    BunTest.expect(findConfigPath(configPath)).toBe(configPath);
  });

  BunTest.test("returns null when no config file exists", () => {
    BunTest.expect(
      findConfigPath(path.join(tempDir, "nonexistent.json"))
    ).toBeNull();
  });
});

BunTest.describe("saveBrowserToConfig", () => {
  BunTest.test("saves browser to existing config file", () => {
    const configPath = path.join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ repos: ["/BunTest.test"] }));

    const result = saveBrowserToConfig("chromium", configPath);
    BunTest.expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      BunTest.expect(result.value).toBe(configPath);
    }

    const updated = JSON.parse(readFileSync(configPath, "utf-8"));
    BunTest.expect(updated.browser).toBe("chromium");
    BunTest.expect(updated.repos).toEqual(["/BunTest.test"]);
  });

  BunTest.test("creates config when file not found", () => {
    const configPath = path.join(tempDir, "missing.json");
    const result = saveBrowserToConfig("chromium", configPath);
    BunTest.expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      BunTest.expect(result.value).toBe(configPath);
    }
    const created = JSON.parse(readFileSync(configPath, "utf-8"));
    BunTest.expect(created.browser).toBe("chromium");
    BunTest.expect(created.repos).toEqual([]);
  });

  BunTest.test("returns error when config file has invalid JSON", () => {
    const configPath = path.join(tempDir, "bad.json");
    writeFileSync(configPath, "{not valid json");

    const result = saveBrowserToConfig("chromium", configPath);
    BunTest.expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      BunTest.expect(result.error._tag).toBe("ConfigParseError");
    }
  });
});

BunTest.describe("validateRepos", () => {
  BunTest.test(
    "splits paths into valid, missing, and non-git directories",
    () => {
      const validGitDir = path.join(tempDir, "git-repo");
      mkdirSync(validGitDir);
      mkdirSync(path.join(validGitDir, ".git"));

      const notGitDir = path.join(tempDir, "regular-dir");
      mkdirSync(notGitDir);

      const fakePath = path.join(tempDir, "does-not-exist");

      const { valid, missing, notGit } = validateRepos([
        validGitDir,
        notGitDir,
        fakePath,
      ]);
      BunTest.expect(valid).toEqual([validGitDir]);
      BunTest.expect(notGit).toEqual([notGitDir]);
      BunTest.expect(missing).toEqual([fakePath]);
    }
  );
});
