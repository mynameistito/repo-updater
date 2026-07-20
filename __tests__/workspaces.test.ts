import * as BunTest from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  detectWorkspaces,
  getWorkspacePackages,
  resolveWorkspaceGlobs,
} from "../src/workspaces.ts";

const { join } = path;

/** Matches relative path segments for the "my-pkg" workspace package. */
const RELATIVE_PATH_RE = /packages[\\/]my-pkg/u;

let tempDir: string;

BunTest.beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "repo-updater-workspaces-"));
});

BunTest.afterEach(() => {
  rmSync(tempDir, { force: true, recursive: true });
});

/** Creates a minimal package.json in the given directory for BunTest.test fixtures. */
const createPackage = (
  dir: string,
  name: string,
  deps?: Record<string, string>
) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ dependencies: deps ?? {}, name }),
    "utf-8"
  );
};

// ---------------------------------------------------------------------------
// detectWorkspaces
// ---------------------------------------------------------------------------

BunTest.describe("detectWorkspaces", () => {
  BunTest.test("detects workspaces from package.json workspaces array", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "my-monorepo",
        workspaces: ["packages/*"],
      }),
      "utf-8"
    );
    createPackage(join(tempDir, "packages", "pkg-a"), "@scope/pkg-a");
    createPackage(join(tempDir, "packages", "pkg-b"), "@scope/pkg-b");

    const result = detectWorkspaces(tempDir);
    BunTest.expect(result.isWorkspace).toBe(true);
    BunTest.expect(result.packages).toHaveLength(2);
    BunTest.expect(result.packages.map((p) => p.name)).toEqual([
      "@scope/pkg-a",
      "@scope/pkg-b",
    ]);
  });

  BunTest.test(
    "detects workspaces from package.json workspaces.packages object (yarn classic)",
    () => {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "my-monorepo",
          workspaces: { packages: ["packages/*"] },
        }),
        "utf-8"
      );
      createPackage(join(tempDir, "packages", "pkg-a"), "pkg-a");

      const result = detectWorkspaces(tempDir);
      BunTest.expect(result.isWorkspace).toBe(true);
      BunTest.expect(result.packages).toHaveLength(1);
      BunTest.expect(result.packages[0].name).toBe("pkg-a");
    }
  );

  BunTest.test("detects workspaces from pnpm-workspace.yaml", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "my-monorepo" }),
      "utf-8"
    );
    writeFileSync(
      join(tempDir, "pnpm-workspace.yaml"),
      'packages:\n  - "packages/*"\n  - "apps/*"\n',
      "utf-8"
    );
    createPackage(join(tempDir, "packages", "lib"), "my-lib");
    createPackage(join(tempDir, "apps", "web"), "my-web");

    const result = detectWorkspaces(tempDir);
    BunTest.expect(result.isWorkspace).toBe(true);
    BunTest.expect(result.packages).toHaveLength(2);
    BunTest.expect(result.packages.map((p) => p.name).toSorted()).toEqual([
      "my-lib",
      "my-web",
    ]);
  });

  BunTest.test(
    "returns isWorkspace: false when no workspace config exists",
    () => {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({ name: "simple-project" }),
        "utf-8"
      );

      const result = detectWorkspaces(tempDir);
      BunTest.expect(result.isWorkspace).toBe(false);
      BunTest.expect(result.packages).toHaveLength(0);
    }
  );

  BunTest.test("returns isWorkspace: false when no package.json exists", () => {
    const result = detectWorkspaces(tempDir);
    BunTest.expect(result.isWorkspace).toBe(false);
    BunTest.expect(result.packages).toHaveLength(0);
  });

  BunTest.test(
    "returns isWorkspace: false when workspace dirs have no package.json",
    () => {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({ name: "mono", workspaces: ["packages/*"] }),
        "utf-8"
      );
      // Create directory but no package.json inside
      mkdirSync(join(tempDir, "packages", "empty-dir"), { recursive: true });

      const result = detectWorkspaces(tempDir);
      BunTest.expect(result.isWorkspace).toBe(false);
      BunTest.expect(result.packages).toHaveLength(0);
    }
  );

  BunTest.test(
    "pnpm-workspace.yaml takes precedence over package.json workspaces",
    () => {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "mono",
          workspaces: ["other/*"],
        }),
        "utf-8"
      );
      writeFileSync(
        join(tempDir, "pnpm-workspace.yaml"),
        "packages:\n  - packages/*\n",
        "utf-8"
      );
      createPackage(join(tempDir, "packages", "lib"), "pnpm-lib");

      const result = detectWorkspaces(tempDir);
      BunTest.expect(result.isWorkspace).toBe(true);
      BunTest.expect(result.packages[0].name).toBe("pnpm-lib");
    }
  );
});

// ---------------------------------------------------------------------------
// resolveWorkspaceGlobs
// ---------------------------------------------------------------------------

BunTest.describe("resolveWorkspaceGlobs", () => {
  BunTest.test("resolves packages/* pattern to child directories", () => {
    mkdirSync(join(tempDir, "packages", "a"), { recursive: true });
    mkdirSync(join(tempDir, "packages", "b"), { recursive: true });
    // Create a file that should not be included
    writeFileSync(join(tempDir, "packages", "not-a-dir.txt"), "", "utf-8");

    const dirs = resolveWorkspaceGlobs(tempDir, ["packages/*"]);
    BunTest.expect(dirs).toHaveLength(2);
    BunTest.expect(dirs).toContain(join(tempDir, "packages", "a"));
    BunTest.expect(dirs).toContain(join(tempDir, "packages", "b"));
  });

  BunTest.test("handles non-existent glob parent gracefully", () => {
    const dirs = resolveWorkspaceGlobs(tempDir, ["nonexistent/*"]);
    BunTest.expect(dirs).toHaveLength(0);
  });

  BunTest.test("excludes directories matching negation patterns", () => {
    mkdirSync(join(tempDir, "packages", "a"), { recursive: true });
    mkdirSync(join(tempDir, "packages", "internal"), { recursive: true });
    const dirs = resolveWorkspaceGlobs(tempDir, [
      "packages/*",
      "!packages/internal",
    ]);
    BunTest.expect(dirs).toHaveLength(1);
    BunTest.expect(dirs).toContain(join(tempDir, "packages", "a"));
    BunTest.expect(dirs).not.toContain(join(tempDir, "packages", "internal"));
  });

  BunTest.test("handles exact directory paths (no glob)", () => {
    mkdirSync(join(tempDir, "tools"), { recursive: true });
    const dirs = resolveWorkspaceGlobs(tempDir, ["tools"]);
    BunTest.expect(dirs).toHaveLength(1);
    BunTest.expect(dirs[0]).toBe(join(tempDir, "tools"));
  });

  BunTest.test(
    "resolves packages/** pattern to nested directories recursively",
    () => {
      mkdirSync(join(tempDir, "packages", "a"), { recursive: true });
      mkdirSync(join(tempDir, "packages", "group", "nested"), {
        recursive: true,
      });

      const dirs = resolveWorkspaceGlobs(tempDir, ["packages/**"]);
      BunTest.expect(dirs).toContain(join(tempDir, "packages", "a"));
      BunTest.expect(dirs).toContain(join(tempDir, "packages", "group"));
      BunTest.expect(dirs).toContain(
        join(tempDir, "packages", "group", "nested")
      );
    }
  );

  BunTest.test("deduplicates directories from overlapping globs", () => {
    const sharedDir = join(tempDir, "packages", "shared");
    mkdirSync(sharedDir, { recursive: true });

    const dirs = resolveWorkspaceGlobs(tempDir, [
      "packages/*",
      "packages/shared",
    ]);
    BunTest.expect(dirs).toHaveLength(1);
    BunTest.expect(dirs[0]).toBe(sharedDir);
  });
});

// ---------------------------------------------------------------------------
// getWorkspacePackages
// ---------------------------------------------------------------------------

BunTest.describe("getWorkspacePackages", () => {
  BunTest.test("returns packages with name from package.json", () => {
    const dirA = join(tempDir, "packages", "a");
    const dirB = join(tempDir, "packages", "b");
    createPackage(dirA, "@scope/a");
    createPackage(dirB, "@scope/b");

    const packages = getWorkspacePackages(tempDir, [dirA, dirB]);
    BunTest.expect(packages).toHaveLength(2);
    BunTest.expect(packages[0].name).toBe("@scope/a");
    BunTest.expect(packages[0].path).toBe(dirA);
    BunTest.expect(packages[1].name).toBe("@scope/b");
  });

  BunTest.test("skips directories without package.json", () => {
    const dirA = join(tempDir, "packages", "a");
    const dirB = join(tempDir, "packages", "b");
    createPackage(dirA, "has-pkg");
    // Leave dirB without a package.json.
    mkdirSync(dirB, { recursive: true });

    const packages = getWorkspacePackages(tempDir, [dirA, dirB]);
    BunTest.expect(packages).toHaveLength(1);
    BunTest.expect(packages[0].name).toBe("has-pkg");
  });

  BunTest.test(
    "uses directory name when package.json has no name field",
    () => {
      const dir = join(tempDir, "packages", "unnamed");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ version: "1.0.0" }),
        "utf-8"
      );

      const packages = getWorkspacePackages(tempDir, [dir]);
      BunTest.expect(packages).toHaveLength(1);
      BunTest.expect(packages[0].name).toBe("unnamed");
    }
  );

  BunTest.test("sets relativePath correctly", () => {
    const dir = join(tempDir, "packages", "my-pkg");
    createPackage(dir, "my-pkg");

    const packages = getWorkspacePackages(tempDir, [dir]);
    BunTest.expect(packages[0].relativePath).toMatch(RELATIVE_PATH_RE);
  });

  BunTest.test("sorts packages alphabetically by name", () => {
    const dirZ = join(tempDir, "packages", "z");
    const dirA = join(tempDir, "packages", "a");
    createPackage(dirZ, "z-pkg");
    createPackage(dirA, "a-pkg");

    const packages = getWorkspacePackages(tempDir, [dirZ, dirA]);
    BunTest.expect(packages[0].name).toBe("a-pkg");
    BunTest.expect(packages[1].name).toBe("z-pkg");
  });
});
