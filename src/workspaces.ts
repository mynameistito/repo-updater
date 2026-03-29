/**
 * @module workspaces
 *
 * Workspace and monorepo package detection. Resolves workspace globs from
 * `pnpm-workspace.yaml`, `package.json` `workspaces` fields, and Bun
 * workspaces. Provides utilities for discovering workspace packages and
 * resolving glob patterns to concrete directory paths.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { readPackageJson } from "./package-json.ts";

const TRAILING_WILDCARD_RE = /\/\*\*?$/;

/**
 * Describes a single workspace package discovered within a monorepo.
 *
 * @property name - The package name from its `package.json`.
 * @property path - Absolute path to the package directory.
 * @property relativePath - The package directory path relative to the repo root.
 */
export interface WorkspacePackage {
  name: string;
  path: string;
  relativePath: string;
}

/**
 * Describes the workspace configuration for a repository.
 *
 * @property isWorkspace - Whether the repository uses workspace packages.
 * @property packages - Array of discovered {@link WorkspacePackage} entries.
 */
export interface WorkspaceConfig {
  isWorkspace: boolean;
  packages: WorkspacePackage[];
}

/**
 * Parses a `pnpm-workspace.yaml` file and extracts workspace glob patterns.
 *
 * @param repoPath - Absolute path to the repository root.
 * @returns Array of glob pattern strings, or `null` if no file exists or
 *   the file contains no valid `packages` array.
 */
function parsePnpmWorkspaceYaml(repoPath: string): string[] | null {
  const yamlPath = join(repoPath, "pnpm-workspace.yaml");
  if (!existsSync(yamlPath)) {
    return null;
  }
  try {
    const content = readFileSync(yamlPath, "utf8");
    const doc = parseYaml(content) as Record<string, unknown> | null;
    if (!doc || typeof doc !== "object") {
      return null;
    }

    const packages = doc.packages;
    if (!Array.isArray(packages)) {
      return null;
    }

    const globs = packages.filter((w): w is string => typeof w === "string");
    return globs.length > 0 ? globs : null;
  } catch {
    return null;
  }
}

/**
 * Extracts workspace glob patterns from the repository, checking
 * `pnpm-workspace.yaml` first, then the `workspaces` field in
 * `package.json` (both array and `{ packages: [...] }` forms).
 *
 * @param repoPath - Absolute path to the repository root.
 * @returns Array of glob pattern strings, or `null` if no workspace
 *   configuration is found.
 */
function getWorkspaceGlobs(repoPath: string): string[] | null {
  // Check pnpm-workspace.yaml first
  const pnpmGlobs = parsePnpmWorkspaceYaml(repoPath);
  if (pnpmGlobs) {
    return pnpmGlobs;
  }

  // Check package.json workspaces field
  const pkg = readPackageJson(repoPath);
  if (!pkg) {
    return null;
  }

  const workspaces = pkg.workspaces;
  if (Array.isArray(workspaces)) {
    // npm/yarn/bun: workspaces: ["packages/*", "apps/*"]
    const filtered = workspaces.filter(
      (w): w is string => typeof w === "string"
    );
    return filtered.length > 0 ? filtered : null;
  }

  if (
    typeof workspaces === "object" &&
    workspaces !== null &&
    "packages" in workspaces
  ) {
    // yarn classic: workspaces: { packages: ["packages/*"] }
    const pkgs = (workspaces as { packages: unknown }).packages;
    if (Array.isArray(pkgs)) {
      const filtered = pkgs.filter((w): w is string => typeof w === "string");
      return filtered.length > 0 ? filtered : null;
    }
  }

  return null;
}

/**
 * Lists immediate child directories of the given parent directory.
 *
 * @param parentDir - Absolute path to the directory to scan.
 * @returns Array of absolute directory paths for each direct child directory,
 *   or an empty array on error.
 */
function listChildDirs(parentDir: string): string[] {
  try {
    const entries = readdirSync(parentDir);
    const dirs: string[] = [];
    for (const entry of entries) {
      const fullPath = join(parentDir, entry);
      try {
        if (statSync(fullPath).isDirectory()) {
          dirs.push(fullPath);
        }
      } catch {
        // Skip entries we can't stat
      }
    }
    return dirs;
  } catch {
    return [];
  }
}

/**
 * Recursively lists all directories under the given parent directory.
 *
 * @param parentDir - Absolute path to the directory to scan.
 * @returns Array of absolute directory paths for all descendant directories.
 */
function listDirsRecursive(parentDir: string): string[] {
  const results: string[] = [];
  for (const dir of listChildDirs(parentDir)) {
    results.push(dir);
    results.push(...listDirsRecursive(dir));
  }
  return results;
}

/**
 * Resolves a single workspace glob pattern to concrete directory paths.
 * Handles trailing wildcards (`*`, `**`), inline wildcards, and literal
 * directory paths.
 *
 * @param repoPath - Absolute path to the repository root.
 * @param glob - The workspace glob pattern to resolve.
 * @returns Array of absolute directory paths matching the glob, or an empty
 *   array if the parent directory does not exist.
 */
function resolveGlob(repoPath: string, glob: string): string[] {
  const cleaned = glob.replace(TRAILING_WILDCARD_RE, "");
  const parentDir = join(repoPath, cleaned);

  if (!existsSync(parentDir)) {
    return [];
  }

  if (glob.endsWith("/**")) {
    return [parentDir, ...listDirsRecursive(parentDir)];
  }

  if (glob.includes("*")) {
    return listChildDirs(parentDir);
  }

  try {
    const stat = statSync(parentDir);
    return stat.isDirectory() ? [parentDir] : [];
  } catch {
    return [];
  }
}

/**
 * Resolves workspace glob patterns to concrete directory paths.
 * Negation patterns (starting with `!`) are applied as exclusion filters
 * after all inclusion globs are resolved. Duplicates are de-duplicated.
 */
export function resolveWorkspaceGlobs(
  repoPath: string,
  globs: string[]
): string[] {
  const seen = new Set<string>();
  const dirs: string[] = [];
  const excluded = new Set<string>();

  // First pass: resolve negation patterns to build exclusion set
  for (const glob of globs) {
    if (glob.startsWith("!")) {
      for (const dir of resolveGlob(repoPath, glob.slice(1))) {
        excluded.add(dir);
      }
    }
  }

  // Second pass: resolve inclusion patterns, filtering out excluded dirs
  for (const glob of globs) {
    if (glob.startsWith("!")) {
      continue;
    }
    for (const dir of resolveGlob(repoPath, glob)) {
      if (!(seen.has(dir) || excluded.has(dir))) {
        seen.add(dir);
        dirs.push(dir);
      }
    }
  }

  return dirs;
}

/** Returns workspace packages found in the given directories, sorted by name. */
export function getWorkspacePackages(
  repoPath: string,
  dirs: string[]
): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];

  for (const dir of dirs) {
    const pkg = readPackageJson(dir);
    if (!pkg) {
      continue;
    }

    const name = typeof pkg.name === "string" ? pkg.name : basename(dir);
    packages.push({
      name,
      path: dir,
      relativePath: relative(repoPath, dir),
    });
  }

  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

/** Detects whether a repo is a monorepo with workspaces and returns its packages. */
export function detectWorkspaces(repoPath: string): WorkspaceConfig {
  const globs = getWorkspaceGlobs(repoPath);
  if (!globs || globs.length === 0) {
    return { isWorkspace: false, packages: [] };
  }

  const dirs = resolveWorkspaceGlobs(repoPath, globs);
  const packages = getWorkspacePackages(repoPath, dirs);

  if (packages.length === 0) {
    return { isWorkspace: false, packages: [] };
  }

  return { isWorkspace: true, packages };
}
