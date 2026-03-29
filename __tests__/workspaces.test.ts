import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectWorkspaces,
  getWorkspacePackages,
  resolveWorkspaceGlobs,
} from "../src/workspaces.ts";

/** Matches relative path segments for the "my-pkg" workspace package. */
const RELATIVE_PATH_RE = /packages[\\/]my-pkg/;

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "repo-updater-workspaces-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Creates a minimal package.json in the given directory for test fixtures. */
function createPackage(
  dir: string,
  name: string,
  deps?: Record<string, string>
) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, dependencies: deps ?? {} }),
    "utf8"
  );
}

// ---------------------------------------------------------------------------
// detectWorkspaces
// ---------------------------------------------------------------------------

describe("detectWorkspaces", () => {
  test("detects workspaces from package.json workspaces array", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "my-monorepo",
        workspaces: ["packages/*"],
      }),
      "utf8"
    );
    createPackage(join(tempDir, "packages", "pkg-a"), "@scope/pkg-a");
    createPackage(join(tempDir, "packages", "pkg-b"), "@scope/pkg-b");

    const result = detectWorkspaces(tempDir);
    expect(result.isWorkspace).toBe(true);
    expect(result.packages).toHaveLength(2);
    expect(result.packages.map((p) => p.name)).toEqual([
      "@scope/pkg-a",
      "@scope/pkg-b",
    ]);
  });

  test("detects workspaces from package.json workspaces.packages object (yarn classic)", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "my-monorepo",
        workspaces: { packages: ["packages/*"] },
      }),
      "utf8"
    );
    createPackage(join(tempDir, "packages", "pkg-a"), "pkg-a");

    const result = detectWorkspaces(tempDir);
    expect(result.isWorkspace).toBe(true);
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0].name).toBe("pkg-a");
  });

  test("detects workspaces from pnpm-workspace.yaml", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "my-monorepo" }),
      "utf8"
    );
    writeFileSync(
      join(tempDir, "pnpm-workspace.yaml"),
      'packages:\n  - "packages/*"\n  - "apps/*"\n',
      "utf8"
    );
    createPackage(join(tempDir, "packages", "lib"), "my-lib");
    createPackage(join(tempDir, "apps", "web"), "my-web");

    const result = detectWorkspaces(tempDir);
    expect(result.isWorkspace).toBe(true);
    expect(result.packages).toHaveLength(2);
    expect(result.packages.map((p) => p.name).sort()).toEqual([
      "my-lib",
      "my-web",
    ]);
  });

  test("returns isWorkspace: false when no workspace config exists", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "simple-project" }),
      "utf8"
    );

    const result = detectWorkspaces(tempDir);
    expect(result.isWorkspace).toBe(false);
    expect(result.packages).toHaveLength(0);
  });

  test("returns isWorkspace: false when no package.json exists", () => {
    const result = detectWorkspaces(tempDir);
    expect(result.isWorkspace).toBe(false);
    expect(result.packages).toHaveLength(0);
  });

  test("returns isWorkspace: false when workspace dirs have no package.json", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "mono", workspaces: ["packages/*"] }),
      "utf8"
    );
    // Create directory but no package.json inside
    mkdirSync(join(tempDir, "packages", "empty-dir"), { recursive: true });

    const result = detectWorkspaces(tempDir);
    expect(result.isWorkspace).toBe(false);
    expect(result.packages).toHaveLength(0);
  });

  test("pnpm-workspace.yaml takes precedence over package.json workspaces", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "mono",
        workspaces: ["other/*"],
      }),
      "utf8"
    );
    writeFileSync(
      join(tempDir, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8"
    );
    createPackage(join(tempDir, "packages", "lib"), "pnpm-lib");

    const result = detectWorkspaces(tempDir);
    expect(result.isWorkspace).toBe(true);
    expect(result.packages[0].name).toBe("pnpm-lib");
  });
});

// ---------------------------------------------------------------------------
// resolveWorkspaceGlobs
// ---------------------------------------------------------------------------

describe("resolveWorkspaceGlobs", () => {
  test("resolves packages/* pattern to child directories", () => {
    mkdirSync(join(tempDir, "packages", "a"), { recursive: true });
    mkdirSync(join(tempDir, "packages", "b"), { recursive: true });
    // Create a file that should not be included
    writeFileSync(join(tempDir, "packages", "not-a-dir.txt"), "", "utf8");

    const dirs = resolveWorkspaceGlobs(tempDir, ["packages/*"]);
    expect(dirs).toHaveLength(2);
    expect(dirs).toContain(join(tempDir, "packages", "a"));
    expect(dirs).toContain(join(tempDir, "packages", "b"));
  });

  test("handles non-existent glob parent gracefully", () => {
    const dirs = resolveWorkspaceGlobs(tempDir, ["nonexistent/*"]);
    expect(dirs).toHaveLength(0);
  });

  test("excludes directories matching negation patterns", () => {
    mkdirSync(join(tempDir, "packages", "a"), { recursive: true });
    mkdirSync(join(tempDir, "packages", "internal"), { recursive: true });
    const dirs = resolveWorkspaceGlobs(tempDir, [
      "packages/*",
      "!packages/internal",
    ]);
    expect(dirs).toHaveLength(1);
    expect(dirs).toContain(join(tempDir, "packages", "a"));
    expect(dirs).not.toContain(join(tempDir, "packages", "internal"));
  });

  test("handles exact directory paths (no glob)", () => {
    mkdirSync(join(tempDir, "tools"), { recursive: true });
    const dirs = resolveWorkspaceGlobs(tempDir, ["tools"]);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(join(tempDir, "tools"));
  });

  test("resolves packages/** pattern to nested directories recursively", () => {
    mkdirSync(join(tempDir, "packages", "a"), { recursive: true });
    mkdirSync(join(tempDir, "packages", "group", "nested"), {
      recursive: true,
    });

    const dirs = resolveWorkspaceGlobs(tempDir, ["packages/**"]);
    expect(dirs).toContain(join(tempDir, "packages", "a"));
    expect(dirs).toContain(join(tempDir, "packages", "group"));
    expect(dirs).toContain(join(tempDir, "packages", "group", "nested"));
  });

  test("deduplicates directories from overlapping globs", () => {
    const sharedDir = join(tempDir, "packages", "shared");
    mkdirSync(sharedDir, { recursive: true });

    const dirs = resolveWorkspaceGlobs(tempDir, [
      "packages/*",
      "packages/shared",
    ]);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(sharedDir);
  });
});

// ---------------------------------------------------------------------------
// getWorkspacePackages
// ---------------------------------------------------------------------------

describe("getWorkspacePackages", () => {
  test("returns packages with name from package.json", () => {
    const dirA = join(tempDir, "packages", "a");
    const dirB = join(tempDir, "packages", "b");
    createPackage(dirA, "@scope/a");
    createPackage(dirB, "@scope/b");

    const packages = getWorkspacePackages(tempDir, [dirA, dirB]);
    expect(packages).toHaveLength(2);
    expect(packages[0].name).toBe("@scope/a");
    expect(packages[0].path).toBe(dirA);
    expect(packages[1].name).toBe("@scope/b");
  });

  test("skips directories without package.json", () => {
    const dirA = join(tempDir, "packages", "a");
    const dirB = join(tempDir, "packages", "b");
    createPackage(dirA, "has-pkg");
    mkdirSync(dirB, { recursive: true }); // no package.json

    const packages = getWorkspacePackages(tempDir, [dirA, dirB]);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe("has-pkg");
  });

  test("uses directory name when package.json has no name field", () => {
    const dir = join(tempDir, "packages", "unnamed");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ version: "1.0.0" }),
      "utf8"
    );

    const packages = getWorkspacePackages(tempDir, [dir]);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe("unnamed");
  });

  test("sets relativePath correctly", () => {
    const dir = join(tempDir, "packages", "my-pkg");
    createPackage(dir, "my-pkg");

    const packages = getWorkspacePackages(tempDir, [dir]);
    expect(packages[0].relativePath).toMatch(RELATIVE_PATH_RE);
  });

  test("sorts packages alphabetically by name", () => {
    const dirZ = join(tempDir, "packages", "z");
    const dirA = join(tempDir, "packages", "a");
    createPackage(dirZ, "z-pkg");
    createPackage(dirA, "a-pkg");

    const packages = getWorkspacePackages(tempDir, [dirZ, dirA]);
    expect(packages[0].name).toBe("a-pkg");
    expect(packages[1].name).toBe("z-pkg");
  });
});
