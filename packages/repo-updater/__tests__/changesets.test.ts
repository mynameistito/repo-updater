import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DepSnapshot,
  diffDeps,
  diffWorkspaceDeps,
  getChangesetFiles,
  getPackageName,
  hasChangesets,
  snapshotDeps,
  snapshotWorkspaceDeps,
  writeChangesetFile,
  writeWorkspaceChangesetFile,
} from "../src/changesets.ts";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "repo-updater-changesets-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// hasChangesets
// ---------------------------------------------------------------------------

describe("hasChangesets", () => {
  test("returns true when .changeset/config.json exists", () => {
    mkdirSync(join(tempDir, ".changeset"));
    writeFileSync(join(tempDir, ".changeset", "config.json"), "{}", "utf8");
    expect(hasChangesets(tempDir)).toBe(true);
  });

  test("returns true when @changesets/cli is in devDependencies", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ devDependencies: { "@changesets/cli": "^2.0.0" } }),
      "utf8"
    );
    expect(hasChangesets(tempDir)).toBe(true);
  });

  test("returns false when neither condition is met", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ devDependencies: { "some-other-pkg": "^1.0.0" } }),
      "utf8"
    );
    expect(hasChangesets(tempDir)).toBe(false);
  });

  test("returns false with no package.json and no .changeset dir", () => {
    expect(hasChangesets(tempDir)).toBe(false);
  });

  test("returns false when package.json is malformed JSON", () => {
    writeFileSync(join(tempDir, "package.json"), "not json", "utf8");
    expect(hasChangesets(tempDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// snapshotDeps
// ---------------------------------------------------------------------------

describe("snapshotDeps", () => {
  test("captures dependencies only, ignores devDependencies and peerDependencies", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        dependencies: { react: "18.2.0", zod: "3.21.0" },
        devDependencies: { typescript: "5.0.0" },
        peerDependencies: { "react-dom": "18.2.0" },
      }),
      "utf8"
    );
    expect(snapshotDeps(tempDir)).toEqual({
      react: "18.2.0",
      zod: "3.21.0",
    });
  });

  test("returns {} when package.json is missing", () => {
    expect(snapshotDeps(tempDir)).toEqual({});
  });

  test("returns {} when package.json has no dependencies field", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "my-lib" }),
      "utf8"
    );
    expect(snapshotDeps(tempDir)).toEqual({});
  });

  test("returns {} when package.json is malformed JSON", () => {
    writeFileSync(join(tempDir, "package.json"), "not json", "utf8");
    expect(snapshotDeps(tempDir)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// diffDeps
// ---------------------------------------------------------------------------

describe("diffDeps", () => {
  test("detects version changes", () => {
    const before = { react: "18.2.0", zod: "3.21.0" };
    const after = { react: "18.3.1", zod: "3.21.0" };
    expect(diffDeps(before, after)).toEqual([
      { name: "react", from: "18.2.0", to: "18.3.1" },
    ]);
  });

  test("detects added packages", () => {
    const before = { react: "18.2.0" };
    const after = { react: "18.2.0", zod: "3.24.0" };
    expect(diffDeps(before, after)).toEqual([
      { name: "zod", from: "", to: "3.24.0" },
    ]);
  });

  test("detects removed packages", () => {
    const before = { react: "18.2.0", lodash: "4.17.0" };
    const after = { react: "18.2.0" };
    expect(diffDeps(before, after)).toEqual([
      { name: "lodash", from: "4.17.0", to: "" },
    ]);
  });

  test("returns empty array when nothing changed", () => {
    const snap = { react: "18.2.0" };
    expect(diffDeps(snap, snap)).toEqual([]);
  });

  test("sorts results alphabetically", () => {
    const before = { zod: "3.21.0", react: "18.2.0" };
    const after = { zod: "3.24.0", react: "18.3.1" };
    const result = diffDeps(before, after);
    expect(result.map((c) => c.name)).toEqual(["react", "zod"]);
  });
});

// ---------------------------------------------------------------------------
// getChangesetFiles
// ---------------------------------------------------------------------------

describe("getChangesetFiles", () => {
  test("returns [] when .changeset directory does not exist", () => {
    expect(getChangesetFiles(tempDir)).toEqual([]);
  });

  test("lists .md files, excludes README.md and non-.md files", () => {
    mkdirSync(join(tempDir, ".changeset"));
    writeFileSync(
      join(tempDir, ".changeset", "dep-updates-123.md"),
      "",
      "utf8"
    );
    writeFileSync(join(tempDir, ".changeset", "README.md"), "", "utf8");
    writeFileSync(join(tempDir, ".changeset", "config.json"), "{}", "utf8");
    const files = getChangesetFiles(tempDir);
    expect(files).toContain("dep-updates-123.md");
    expect(files).not.toContain("README.md");
    expect(files).not.toContain("config.json");
  });

  test("returns [] for empty .changeset directory", () => {
    mkdirSync(join(tempDir, ".changeset"));
    expect(getChangesetFiles(tempDir)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// writeChangesetFile
// ---------------------------------------------------------------------------

describe("writeChangesetFile", () => {
  test("writes correct frontmatter and body", () => {
    mkdirSync(join(tempDir, ".changeset"));
    const changes = [
      { name: "react", from: "18.2.0", to: "18.3.1" },
      { name: "zod", from: "3.21.0", to: "3.24.1" },
    ];
    writeChangesetFile(tempDir, "my-lib", changes, 1_234_567_890);

    const content = readFileSync(
      join(tempDir, ".changeset", "dep-updates-1234567890.md"),
      "utf8"
    );
    expect(content).toContain('---\n"my-lib": patch\n---');
    expect(content).toContain("Updated dependencies:");
    expect(content).toContain("- react: 18.2.0 → 18.3.1");
    expect(content).toContain("- zod: 3.21.0 → 3.24.1");
  });

  test("creates .changeset directory if it does not exist", () => {
    const changes = [{ name: "react", from: "18.2.0", to: "18.3.1" }];
    writeChangesetFile(tempDir, "my-lib", changes, 9999);
    const content = readFileSync(
      join(tempDir, ".changeset", "dep-updates-9999.md"),
      "utf8"
    );
    expect(content).toContain('"my-lib": patch');
  });

  test("handles (new) placeholder for added packages with empty from", () => {
    mkdirSync(join(tempDir, ".changeset"));
    const changes = [
      { name: "new-pkg", from: "", to: "1.0.0" },
      { name: "updated-pkg", from: "2.0.0", to: "2.1.0" },
    ];
    writeChangesetFile(tempDir, "my-lib", changes, 5555);

    const content = readFileSync(
      join(tempDir, ".changeset", "dep-updates-5555.md"),
      "utf8"
    );
    expect(content).toContain("- new-pkg: (new) → 1.0.0");
    expect(content).toContain("- updated-pkg: 2.0.0 → 2.1.0");
  });

  test("handles (removed) placeholder for removed packages with empty to", () => {
    mkdirSync(join(tempDir, ".changeset"));
    const changes = [
      { name: "old-pkg", from: "2.0.0", to: "" },
      { name: "updated-pkg", from: "1.0.0", to: "1.1.0" },
    ];
    writeChangesetFile(tempDir, "my-lib", changes, 7777);

    const content = readFileSync(
      join(tempDir, ".changeset", "dep-updates-7777.md"),
      "utf8"
    );
    expect(content).toContain("- old-pkg: 2.0.0 → (removed)");
    expect(content).toContain("- updated-pkg: 1.0.0 → 1.1.0");
  });
});

// ---------------------------------------------------------------------------
// getPackageName
// ---------------------------------------------------------------------------

describe("getPackageName", () => {
  test("returns name from package.json", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "my-lib" }),
      "utf8"
    );
    expect(getPackageName(tempDir)).toBe("my-lib");
  });

  test('returns "unknown" when package.json is missing', () => {
    expect(getPackageName(tempDir)).toBe("unknown");
  });

  test('returns "unknown" when package.json has no name field', () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ version: "1.0.0" }),
      "utf8"
    );
    expect(getPackageName(tempDir)).toBe("unknown");
  });

  test('returns "unknown" when package.json is malformed JSON', () => {
    writeFileSync(join(tempDir, "package.json"), "not json", "utf8");
    expect(getPackageName(tempDir)).toBe("unknown");
  });

  test('returns "unknown" when name field is non-string', () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: 42 }),
      "utf8"
    );
    expect(getPackageName(tempDir)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// snapshotWorkspaceDeps
// ---------------------------------------------------------------------------

describe("snapshotWorkspaceDeps", () => {
  test("snapshots deps from root and all workspace packages", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "root", dependencies: { shared: "1.0.0" } }),
      "utf8"
    );
    const pkgADir = join(tempDir, "packages", "a");
    mkdirSync(pkgADir, { recursive: true });
    writeFileSync(
      join(pkgADir, "package.json"),
      JSON.stringify({ name: "@scope/a", dependencies: { react: "18.2.0" } }),
      "utf8"
    );

    const snapshots = snapshotWorkspaceDeps(tempDir, [
      { name: "@scope/a", path: pkgADir, relativePath: "packages/a" },
    ]);

    expect(snapshots.size).toBe(2);
    expect(snapshots.get("root")).toEqual({ shared: "1.0.0" });
    expect(snapshots.get("@scope/a")).toEqual({ react: "18.2.0" });
  });

  test("skips root when package name is unknown", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ dependencies: { shared: "1.0.0" } }),
      "utf8"
    );

    const snapshots = snapshotWorkspaceDeps(tempDir, []);
    expect(snapshots.size).toBe(0);
  });

  test("skips duplicate package names and keeps the first entry", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "root" }),
      "utf8"
    );
    const dirA = join(tempDir, "packages", "a");
    const dirB = join(tempDir, "packages", "b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    writeFileSync(
      join(dirA, "package.json"),
      JSON.stringify({ name: "dupe", dependencies: { react: "18.0.0" } }),
      "utf8"
    );
    writeFileSync(
      join(dirB, "package.json"),
      JSON.stringify({ name: "dupe", dependencies: { react: "19.0.0" } }),
      "utf8"
    );

    const snapshots = snapshotWorkspaceDeps(tempDir, [
      { name: "dupe", path: dirA, relativePath: "packages/a" },
      { name: "dupe", path: dirB, relativePath: "packages/b" },
    ]);

    // Should keep the first "dupe" entry (react 18.0.0), not overwrite with the second
    expect(snapshots.get("dupe")).toEqual({ react: "18.0.0" });
  });
});

// ---------------------------------------------------------------------------
// diffWorkspaceDeps
// ---------------------------------------------------------------------------

describe("diffWorkspaceDeps", () => {
  test("diffs per-package and only returns packages with changes", () => {
    const before = new Map<string, DepSnapshot>([
      ["pkg-a", { react: "18.2.0" }],
      ["pkg-b", { zod: "3.21.0" }],
    ]);
    const after = new Map<string, DepSnapshot>([
      ["pkg-a", { react: "18.3.1" }],
      ["pkg-b", { zod: "3.21.0" }], // unchanged
    ]);

    const result = diffWorkspaceDeps(before, after);
    expect(result.size).toBe(1);
    expect(result.has("pkg-a")).toBe(true);
    expect(result.get("pkg-a")).toEqual([
      { name: "react", from: "18.2.0", to: "18.3.1" },
    ]);
  });

  test("returns empty map when nothing changed", () => {
    const snap = new Map<string, DepSnapshot>([["pkg-a", { react: "18.2.0" }]]);
    const result = diffWorkspaceDeps(snap, snap);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// writeWorkspaceChangesetFile
// ---------------------------------------------------------------------------

describe("writeWorkspaceChangesetFile", () => {
  test("writes frontmatter with all changed packages", () => {
    mkdirSync(join(tempDir, ".changeset"));
    const changes = new Map([
      ["@scope/a", [{ name: "react", from: "18.2.0", to: "18.3.1" }]],
      ["@scope/b", [{ name: "zod", from: "3.21.0", to: "3.24.0" }]],
    ]);

    writeWorkspaceChangesetFile(tempDir, changes, 1_234_567_890);

    const content = readFileSync(
      join(tempDir, ".changeset", "dep-updates-1234567890.md"),
      "utf8"
    );
    expect(content).toContain('"@scope/a": patch');
    expect(content).toContain('"@scope/b": patch');
    expect(content).toContain("**@scope/a**:");
    expect(content).toContain("- react: 18.2.0");
    expect(content).toContain("**@scope/b**:");
    expect(content).toContain("- zod: 3.21.0");
  });

  test("creates .changeset directory if it does not exist", () => {
    const changes = new Map([
      ["pkg", [{ name: "react", from: "18.2.0", to: "18.3.1" }]],
    ]);
    writeWorkspaceChangesetFile(tempDir, changes, 9999);
    const content = readFileSync(
      join(tempDir, ".changeset", "dep-updates-9999.md"),
      "utf8"
    );
    expect(content).toContain('"pkg": patch');
  });

  test("does nothing when changedPackages map is empty", () => {
    writeWorkspaceChangesetFile(tempDir, new Map(), 1111);
    expect(existsSync(join(tempDir, ".changeset"))).toBe(false);
  });
});
