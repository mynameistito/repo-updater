/**
 * @module changesets
 *
 * Changeset file management for dependency updates. Provides utilities to
 * snapshot dependency versions before and after updates, diff the results,
 * and generate `.changeset/*.md` files documenting what changed. Supports
 * both single-package and workspace-aware changeset generation.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readPackageJson } from "./package-json.ts";
import type { WorkspacePackage } from "./workspaces.ts";

/** Arrow character used in changeset diff lines. */
const DEPENDENCY_ARROW = "→";

/**
 * Records the current versions of a package's dependencies.
 *
 * Keys are dependency names, values are resolved version strings
 * (e.g. `"^1.2.3"` or `"workspace:*"`).
 */
export type DepSnapshot = Record<string, string>;

/**
 * Describes a single dependency version change between two snapshots.
 *
 * @property {string} name - The dependency package name.
 * @property {string} from - The previous version string, or empty string for added deps.
 * @property {string} to - The new version string, or empty string for removed deps.
 */
export interface DepChange {
  from: string;
  name: string;
  to: string;
}

/**
 * Checks whether a repository uses the changeset system by looking for
 * a `.changeset/config.json` file, or by checking for `@changesets/cli`
 * in `devDependencies`.
 *
 * @param repoPath - Absolute path to the repository root.
 * @returns `true` if the repo uses changesets.
 */
export const hasChangesets = (repoPath: string): boolean => {
  if (existsSync(path.join(repoPath, ".changeset", "config.json"))) {
    return true;
  }
  const pkg = readPackageJson(repoPath);
  if (!pkg) {
    return false;
  }
  const devDeps = pkg.devDependencies;
  return (
    typeof devDeps === "object" &&
    devDeps !== null &&
    "@changesets/cli" in devDeps
  );
};

/**
 * Captures the current `dependencies` versions from a package's `package.json`.
 *
 * @param repoPath - Absolute path to the package directory.
 * @returns A {@link DepSnapshot} mapping dependency names to version strings.
 */
export const snapshotDeps = (repoPath: string): DepSnapshot => {
  const pkg = readPackageJson(repoPath);
  if (!pkg) {
    return {};
  }
  // Values are assumed to be strings (standard for npm dependencies).
  // Non-string values (e.g. workspace protocol objects) are not handled.
  const deps =
    typeof pkg.dependencies === "object" && pkg.dependencies !== null
      ? (pkg.dependencies as Record<string, string>)
      : {};
  return deps;
};

/**
 * Computes the differences between two dependency snapshots.
 *
 * Compares every key present in either snapshot and reports entries
 * where the version string differs.
 *
 * @param before - The snapshot taken before the update.
 * @param after - The snapshot taken after the update.
 * @returns Sorted array of {@link DepChange} entries describing what changed.
 */
export const diffDeps = (
  before: DepSnapshot,
  after: DepSnapshot
): DepChange[] => {
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: DepChange[] = [];

  for (const name of allKeys) {
    const from = before[name] ?? "";
    const to = after[name] ?? "";
    if (from !== to) {
      changes.push({ from, name, to });
    }
  }

  return changes.toSorted((a, b) => a.name.localeCompare(b.name));
};

/**
 * Lists existing changeset markdown files in the `.changeset` directory.
 *
 * Excludes `README.md` and returns only `.md` files.
 *
 * @param repoPath - Absolute path to the repository root.
 * @returns Sorted array of changeset file basenames (e.g. `["dep-updates-1234.md"]`).
 */
export const getChangesetFiles = (repoPath: string): string[] => {
  const changesetDir = path.join(repoPath, ".changeset");
  if (!existsSync(changesetDir)) {
    return [];
  }
  try {
    return readdirSync(changesetDir)
      .filter((f) => f.endsWith(".md") && f !== "README.md")
      .toSorted();
  } catch {
    return [];
  }
};

/**
 * Reads the `name` field from a package's `package.json`.
 *
 * @param repoPath - Absolute path to the package directory.
 * @returns The package name string, or `"unknown"` if unavailable.
 */
export const getPackageName = (repoPath: string): string => {
  const pkg = readPackageJson(repoPath);
  if (!pkg) {
    return "unknown";
  }
  const { name } = pkg;
  return typeof name === "string" ? name : "unknown";
};

/**
 * Writes a changeset markdown file documenting dependency version changes
 * for a single package.
 *
 * The file is written to `.changeset/dep-updates-{timestamp}.md` with a
 * `patch` bump frontmatter entry for the given package.
 *
 * @param repoPath - Absolute path to the repository root.
 * @param packageName - The package name for the changeset header.
 * @param changes - Array of {@link DepChange} entries to document.
 * @param timestamp - Unix timestamp used in the output filename.
 */
export const writeChangesetFile = (
  repoPath: string,
  packageName: string,
  changes: DepChange[],
  timestamp: number
): void => {
  if (changes.length === 0) {
    return;
  }

  const changesetDir = path.join(repoPath, ".changeset");
  if (!existsSync(changesetDir)) {
    mkdirSync(changesetDir, { recursive: true });
  }

  const bullets = changes
    .map(
      (c) =>
        `- ${c.name}: ${c.from || "(new)"} ${DEPENDENCY_ARROW} ${c.to || "(removed)"}`
    )
    .join("\n");

  const content = `---\n"${packageName}": patch\n---\n\nUpdated dependencies:\n${bullets}\n`;

  writeFileSync(
    path.join(changesetDir, `dep-updates-${timestamp}.md`),
    content,
    "utf-8"
  );
};

/** Snapshots `dependencies` for the root package and all workspace packages. */
export const snapshotWorkspaceDeps = (
  repoPath: string,
  packages: WorkspacePackage[]
): Map<string, DepSnapshot> => {
  const snapshots = new Map<string, DepSnapshot>();

  // Include root package
  const rootName = getPackageName(repoPath);
  if (rootName !== "unknown") {
    snapshots.set(rootName, snapshotDeps(repoPath));
  }

  // Include each workspace package
  for (const pkg of packages) {
    if (snapshots.has(pkg.name)) {
      console.warn(
        `[warn] Duplicate package name "${pkg.name}" at ${pkg.path} — skipping (already captured)`
      );
      continue;
    }
    snapshots.set(pkg.name, snapshotDeps(pkg.path));
  }

  return snapshots;
};

/** Diffs before/after workspace dependency snapshots, returning only packages with changes. */
export const diffWorkspaceDeps = (
  before: Map<string, DepSnapshot>,
  after: Map<string, DepSnapshot>
): Map<string, DepChange[]> => {
  const allNames = new Set([...before.keys(), ...after.keys()]);
  const result = new Map<string, DepChange[]>();

  for (const name of allNames) {
    const b = before.get(name) ?? {};
    const a = after.get(name) ?? {};
    const changes = diffDeps(b, a);
    if (changes.length > 0) {
      result.set(name, changes);
    }
  }

  return result;
};

/** Writes a multi-package changeset file listing dependency changes per workspace package. */
export const writeWorkspaceChangesetFile = (
  repoPath: string,
  changedPackages: Map<string, DepChange[]>,
  timestamp: number
): void => {
  if (changedPackages.size === 0) {
    return;
  }

  const changesetDir = path.join(repoPath, ".changeset");
  if (!existsSync(changesetDir)) {
    mkdirSync(changesetDir, { recursive: true });
  }

  // Build frontmatter with all changed packages
  const frontmatterLines = [...changedPackages.keys()]
    .toSorted()
    .map((name) => `"${name}": patch`);

  // Build body with per-package change details
  const bodyParts: string[] = [];
  for (const [name, changes] of [...changedPackages.entries()].toSorted(
    (a, b) => a[0].localeCompare(b[0])
  )) {
    const bullets = changes
      .map(
        (c) =>
          `- ${c.name}: ${c.from || "(new)"} ${DEPENDENCY_ARROW} ${c.to || "(removed)"}`
      )
      .join("\n");
    bodyParts.push(`**${name}**:\n${bullets}`);
  }

  const content = `---\n${frontmatterLines.join("\n")}\n---\n\nUpdated dependencies:\n${bodyParts.join("\n\n")}\n`;

  writeFileSync(
    path.join(changesetDir, `dep-updates-${timestamp}.md`),
    content,
    "utf-8"
  );
};
