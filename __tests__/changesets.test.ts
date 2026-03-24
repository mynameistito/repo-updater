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
  diffDeps,
  getChangesetFiles,
  hasChangesets,
  snapshotDeps,
  writeChangesetFile,
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

  test("lists .md files, excludes README.md", () => {
    mkdirSync(join(tempDir, ".changeset"));
    writeFileSync(
      join(tempDir, ".changeset", "dep-updates-123.md"),
      "",
      "utf8"
    );
    writeFileSync(join(tempDir, ".changeset", "README.md"), "", "utf8");
    const files = getChangesetFiles(tempDir);
    expect(files).toContain("dep-updates-123.md");
    expect(files).not.toContain("README.md");
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
      { name: "stable-pkg", from: "1.0.0", to: "1.0.0" },
    ];
    writeChangesetFile(tempDir, "my-lib", changes, 7777);

    const content = readFileSync(
      join(tempDir, ".changeset", "dep-updates-7777.md"),
      "utf8"
    );
    expect(content).toContain("- old-pkg: 2.0.0 → (removed)");
  });
});
