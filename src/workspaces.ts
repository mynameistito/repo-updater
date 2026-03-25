import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { parse as parseYaml } from "yaml";

const GLOB_SUFFIX_RE = /\/\*\*?$/;

export interface WorkspacePackage {
  name: string;
  path: string;
  relativePath: string;
}

export interface WorkspaceConfig {
  isWorkspace: boolean;
  packages: WorkspacePackage[];
}

function readPackageJson(dir: string): Record<string, unknown> | null {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

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
    return workspaces.filter((w): w is string => typeof w === "string");
  }

  if (
    typeof workspaces === "object" &&
    workspaces !== null &&
    "packages" in workspaces
  ) {
    // yarn classic: workspaces: { packages: ["packages/*"] }
    const pkgs = (workspaces as { packages: unknown }).packages;
    if (Array.isArray(pkgs)) {
      return pkgs.filter((w): w is string => typeof w === "string");
    }
  }

  return null;
}

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

function listDirsRecursive(parentDir: string): string[] {
  const results: string[] = [];
  for (const dir of listChildDirs(parentDir)) {
    results.push(dir);
    results.push(...listDirsRecursive(dir));
  }
  return results;
}

function resolveGlob(repoPath: string, glob: string): string[] {
  const cleaned = glob.replace(GLOB_SUFFIX_RE, "");
  const parentDir = join(repoPath, cleaned);

  if (!existsSync(parentDir)) {
    return [];
  }

  if (glob.endsWith("/**")) {
    return listDirsRecursive(parentDir);
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
