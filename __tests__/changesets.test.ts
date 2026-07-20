import * as BunTest from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
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
import type { DepSnapshot } from "../src/changesets.ts";

const { join } = path;

let tempDir: string;

BunTest.beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "repo-updater-changesets-"));
});

BunTest.afterEach(() => {
  rmSync(tempDir, { force: true, recursive: true });
});

// ---------------------------------------------------------------------------
// hasChangesets
// ---------------------------------------------------------------------------

BunTest.describe("hasChangesets", () => {
  BunTest.test("returns true when .changeset/config.json exists", () => {
    mkdirSync(join(tempDir, ".changeset"));
    writeFileSync(join(tempDir, ".changeset", "config.json"), "{}", "utf-8");
    BunTest.expect(hasChangesets(tempDir)).toBe(true);
  });

  BunTest.test(
    "returns true when @changesets/cli is in devDependencies",
    () => {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({ devDependencies: { "@changesets/cli": "^2.0.0" } }),
        "utf-8"
      );
      BunTest.expect(hasChangesets(tempDir)).toBe(true);
    }
  );

  BunTest.test("returns false when neither condition is met", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ devDependencies: { "some-other-pkg": "^1.0.0" } }),
      "utf-8"
    );
    BunTest.expect(hasChangesets(tempDir)).toBe(false);
  });

  BunTest.test(
    "returns false with no package.json and no .changeset dir",
    () => {
      BunTest.expect(hasChangesets(tempDir)).toBe(false);
    }
  );

  BunTest.test("returns false when package.json is malformed JSON", () => {
    writeFileSync(join(tempDir, "package.json"), "not json", "utf-8");
    BunTest.expect(hasChangesets(tempDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// snapshotDeps
// ---------------------------------------------------------------------------

BunTest.describe("snapshotDeps", () => {
  BunTest.test(
    "captures dependencies only, ignores devDependencies and peerDependencies",
    () => {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({
          dependencies: { react: "18.2.0", zod: "3.21.0" },
          devDependencies: { typescript: "5.0.0" },
          peerDependencies: { "react-dom": "18.2.0" },
        }),
        "utf-8"
      );
      BunTest.expect(snapshotDeps(tempDir)).toEqual({
        react: "18.2.0",
        zod: "3.21.0",
      });
    }
  );

  BunTest.test("returns {} when package.json is missing", () => {
    BunTest.expect(snapshotDeps(tempDir)).toEqual({});
  });

  BunTest.test("returns {} when package.json has no dependencies field", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "my-lib" }),
      "utf-8"
    );
    BunTest.expect(snapshotDeps(tempDir)).toEqual({});
  });

  BunTest.test("returns {} when package.json is malformed JSON", () => {
    writeFileSync(join(tempDir, "package.json"), "not json", "utf-8");
    BunTest.expect(snapshotDeps(tempDir)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// diffDeps
// ---------------------------------------------------------------------------

BunTest.describe("diffDeps", () => {
  BunTest.test("detects version changes", () => {
    const before = { react: "18.2.0", zod: "3.21.0" };
    const after = { react: "18.3.1", zod: "3.21.0" };
    BunTest.expect(diffDeps(before, after)).toEqual([
      { from: "18.2.0", name: "react", to: "18.3.1" },
    ]);
  });

  BunTest.test("detects added packages", () => {
    const before = { react: "18.2.0" };
    const after = { react: "18.2.0", zod: "3.24.0" };
    BunTest.expect(diffDeps(before, after)).toEqual([
      { from: "", name: "zod", to: "3.24.0" },
    ]);
  });

  BunTest.test("detects removed packages", () => {
    const before = { lodash: "4.17.0", react: "18.2.0" };
    const after = { react: "18.2.0" };
    BunTest.expect(diffDeps(before, after)).toEqual([
      { from: "4.17.0", name: "lodash", to: "" },
    ]);
  });

  BunTest.test("returns empty array when nothing changed", () => {
    const snap = { react: "18.2.0" };
    BunTest.expect(diffDeps(snap, snap)).toEqual([]);
  });

  BunTest.test("sorts results alphabetically", () => {
    const before = { react: "18.2.0", zod: "3.21.0" };
    const after = { react: "18.3.1", zod: "3.24.0" };
    const result = diffDeps(before, after);
    BunTest.expect(result.map((c) => c.name)).toEqual(["react", "zod"]);
  });
});

// ---------------------------------------------------------------------------
// getChangesetFiles
// ---------------------------------------------------------------------------

BunTest.describe("getChangesetFiles", () => {
  BunTest.test("returns [] when .changeset directory does not exist", () => {
    BunTest.expect(getChangesetFiles(tempDir)).toEqual([]);
  });

  BunTest.test("lists .md files, excludes README.md and non-.md files", () => {
    mkdirSync(join(tempDir, ".changeset"));
    writeFileSync(
      join(tempDir, ".changeset", "dep-updates-123.md"),
      "",
      "utf-8"
    );
    writeFileSync(join(tempDir, ".changeset", "README.md"), "", "utf-8");
    writeFileSync(join(tempDir, ".changeset", "config.json"), "{}", "utf-8");
    const files = getChangesetFiles(tempDir);
    BunTest.expect(files).toContain("dep-updates-123.md");
    BunTest.expect(files).not.toContain("README.md");
    BunTest.expect(files).not.toContain("config.json");
  });

  BunTest.test("returns [] for empty .changeset directory", () => {
    mkdirSync(join(tempDir, ".changeset"));
    BunTest.expect(getChangesetFiles(tempDir)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// writeChangesetFile
// ---------------------------------------------------------------------------

BunTest.describe("writeChangesetFile", () => {
  BunTest.test("writes correct frontmatter and body", () => {
    mkdirSync(join(tempDir, ".changeset"));
    const changes = [
      { from: "18.2.0", name: "react", to: "18.3.1" },
      { from: "3.21.0", name: "zod", to: "3.24.1" },
    ];
    writeChangesetFile(tempDir, "my-lib", changes, 1_234_567_890);

    const content = readFileSync(
      join(tempDir, ".changeset", "dep-updates-1234567890.md"),
      "utf-8"
    );
    BunTest.expect(content).toContain('---\n"my-lib": patch\n---');
    BunTest.expect(content).toContain("Updated dependencies:");
    BunTest.expect(content).toContain("- react: 18.2.0 → 18.3.1");
    BunTest.expect(content).toContain("- zod: 3.21.0 → 3.24.1");
  });

  BunTest.test("creates .changeset directory if it does not exist", () => {
    const changes = [{ from: "18.2.0", name: "react", to: "18.3.1" }];
    writeChangesetFile(tempDir, "my-lib", changes, 9999);
    const content = readFileSync(
      join(tempDir, ".changeset", "dep-updates-9999.md"),
      "utf-8"
    );
    BunTest.expect(content).toContain('"my-lib": patch');
  });

  BunTest.test(
    "handles (new) placeholder for added packages with empty from",
    () => {
      mkdirSync(join(tempDir, ".changeset"));
      const changes = [
        { from: "", name: "new-pkg", to: "1.0.0" },
        { from: "2.0.0", name: "updated-pkg", to: "2.1.0" },
      ];
      writeChangesetFile(tempDir, "my-lib", changes, 5555);

      const content = readFileSync(
        join(tempDir, ".changeset", "dep-updates-5555.md"),
        "utf-8"
      );
      BunTest.expect(content).toContain("- new-pkg: (new) → 1.0.0");
      BunTest.expect(content).toContain("- updated-pkg: 2.0.0 → 2.1.0");
    }
  );

  BunTest.test(
    "handles (removed) placeholder for removed packages with empty to",
    () => {
      mkdirSync(join(tempDir, ".changeset"));
      const changes = [
        { from: "2.0.0", name: "old-pkg", to: "" },
        { from: "1.0.0", name: "updated-pkg", to: "1.1.0" },
      ];
      writeChangesetFile(tempDir, "my-lib", changes, 7777);

      const content = readFileSync(
        join(tempDir, ".changeset", "dep-updates-7777.md"),
        "utf-8"
      );
      BunTest.expect(content).toContain("- old-pkg: 2.0.0 → (removed)");
      BunTest.expect(content).toContain("- updated-pkg: 1.0.0 → 1.1.0");
    }
  );
});

// ---------------------------------------------------------------------------
// getPackageName
// ---------------------------------------------------------------------------

BunTest.describe("getPackageName", () => {
  BunTest.test("returns name from package.json", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "my-lib" }),
      "utf-8"
    );
    BunTest.expect(getPackageName(tempDir)).toBe("my-lib");
  });

  BunTest.test('returns "unknown" when package.json is missing', () => {
    BunTest.expect(getPackageName(tempDir)).toBe("unknown");
  });

  BunTest.test('returns "unknown" when package.json has no name field', () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ version: "1.0.0" }),
      "utf-8"
    );
    BunTest.expect(getPackageName(tempDir)).toBe("unknown");
  });

  BunTest.test('returns "unknown" when package.json is malformed JSON', () => {
    writeFileSync(join(tempDir, "package.json"), "not json", "utf-8");
    BunTest.expect(getPackageName(tempDir)).toBe("unknown");
  });

  BunTest.test('returns "unknown" when name field is non-string', () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: 42 }),
      "utf-8"
    );
    BunTest.expect(getPackageName(tempDir)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// snapshotWorkspaceDeps
// ---------------------------------------------------------------------------

BunTest.describe("snapshotWorkspaceDeps", () => {
  BunTest.test("snapshots deps from root and all workspace packages", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ dependencies: { shared: "1.0.0" }, name: "root" }),
      "utf-8"
    );
    const pkgADir = join(tempDir, "packages", "a");
    mkdirSync(pkgADir, { recursive: true });
    writeFileSync(
      join(pkgADir, "package.json"),
      JSON.stringify({ dependencies: { react: "18.2.0" }, name: "@scope/a" }),
      "utf-8"
    );

    const snapshots = snapshotWorkspaceDeps(tempDir, [
      { name: "@scope/a", path: pkgADir, relativePath: "packages/a" },
    ]);

    BunTest.expect(snapshots.size).toBe(2);
    BunTest.expect(snapshots.get("root")).toEqual({ shared: "1.0.0" });
    BunTest.expect(snapshots.get("@scope/a")).toEqual({ react: "18.2.0" });
  });

  BunTest.test("skips root when package name is unknown", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ dependencies: { shared: "1.0.0" } }),
      "utf-8"
    );

    const snapshots = snapshotWorkspaceDeps(tempDir, []);
    BunTest.expect(snapshots.size).toBe(0);
  });

  BunTest.test(
    "skips duplicate package names and keeps the first entry",
    () => {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({ name: "root" }),
        "utf-8"
      );
      const dirA = join(tempDir, "packages", "a");
      const dirB = join(tempDir, "packages", "b");
      mkdirSync(dirA, { recursive: true });
      mkdirSync(dirB, { recursive: true });
      writeFileSync(
        join(dirA, "package.json"),
        JSON.stringify({ dependencies: { react: "18.0.0" }, name: "dupe" }),
        "utf-8"
      );
      writeFileSync(
        join(dirB, "package.json"),
        JSON.stringify({ dependencies: { react: "19.0.0" }, name: "dupe" }),
        "utf-8"
      );

      const snapshots = snapshotWorkspaceDeps(tempDir, [
        { name: "dupe", path: dirA, relativePath: "packages/a" },
        { name: "dupe", path: dirB, relativePath: "packages/b" },
      ]);

      // Should keep the first "dupe" entry (react 18.0.0), not overwrite with the second
      BunTest.expect(snapshots.get("dupe")).toEqual({ react: "18.0.0" });
    }
  );
});

// ---------------------------------------------------------------------------
// diffWorkspaceDeps
// ---------------------------------------------------------------------------

BunTest.describe("diffWorkspaceDeps", () => {
  BunTest.test(
    "diffs per-package and only returns packages with changes",
    () => {
      const before = new Map<string, DepSnapshot>([
        ["pkg-a", { react: "18.2.0" }],
        ["pkg-b", { zod: "3.21.0" }],
      ]);
      const after = new Map<string, DepSnapshot>([
        ["pkg-a", { react: "18.3.1" }],
        // Unchanged package.
        ["pkg-b", { zod: "3.21.0" }],
      ]);

      const result = diffWorkspaceDeps(before, after);
      BunTest.expect(result.size).toBe(1);
      BunTest.expect(result.has("pkg-a")).toBe(true);
      BunTest.expect(result.get("pkg-a")).toEqual([
        { from: "18.2.0", name: "react", to: "18.3.1" },
      ]);
    }
  );

  BunTest.test("returns empty map when nothing changed", () => {
    const snap = new Map<string, DepSnapshot>([["pkg-a", { react: "18.2.0" }]]);
    const result = diffWorkspaceDeps(snap, snap);
    BunTest.expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// writeWorkspaceChangesetFile
// ---------------------------------------------------------------------------

BunTest.describe("writeWorkspaceChangesetFile", () => {
  BunTest.test("writes frontmatter with all changed packages", () => {
    mkdirSync(join(tempDir, ".changeset"));
    const changes = new Map([
      ["@scope/a", [{ from: "18.2.0", name: "react", to: "18.3.1" }]],
      ["@scope/b", [{ from: "3.21.0", name: "zod", to: "3.24.0" }]],
    ]);

    writeWorkspaceChangesetFile(tempDir, changes, 1_234_567_890);

    const content = readFileSync(
      join(tempDir, ".changeset", "dep-updates-1234567890.md"),
      "utf-8"
    );
    BunTest.expect(content).toContain('"@scope/a": patch');
    BunTest.expect(content).toContain('"@scope/b": patch');
    BunTest.expect(content).toContain("**@scope/a**:");
    BunTest.expect(content).toContain("- react: 18.2.0");
    BunTest.expect(content).toContain("**@scope/b**:");
    BunTest.expect(content).toContain("- zod: 3.21.0");
  });

  BunTest.test("creates .changeset directory if it does not exist", () => {
    const changes = new Map([
      ["pkg", [{ from: "18.2.0", name: "react", to: "18.3.1" }]],
    ]);
    writeWorkspaceChangesetFile(tempDir, changes, 9999);
    const content = readFileSync(
      join(tempDir, ".changeset", "dep-updates-9999.md"),
      "utf-8"
    );
    BunTest.expect(content).toContain('"pkg": patch');
  });

  BunTest.test("does nothing when changedPackages map is empty", () => {
    writeWorkspaceChangesetFile(tempDir, new Map(), 1111);
    BunTest.expect(existsSync(join(tempDir, ".changeset"))).toBe(false);
  });
});
