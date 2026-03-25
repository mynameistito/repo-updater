import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

const LEADING_QUOTE_RE = /^['"]/;
const TRAILING_QUOTE_RE = /['"]$/;
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
    const globs: string[] = [];
    let inPackages = false;

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "packages:" || trimmed === "packages: ") {
        inPackages = true;
        continue;
      }
      if (inPackages) {
        if (trimmed.startsWith("- ")) {
          const glob = trimmed
            .slice(2)
            .trim()
            .replace(LEADING_QUOTE_RE, "")
            .replace(TRAILING_QUOTE_RE, "");
          if (glob) {
            globs.push(glob);
          }
        } else if (trimmed !== "" && !trimmed.startsWith("#")) {
          break;
        }
      }
    }

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

function resolveGlob(repoPath: string, glob: string): string[] {
  const cleaned = glob.replace(GLOB_SUFFIX_RE, "");
  const parentDir = join(repoPath, cleaned);

  if (!existsSync(parentDir)) {
    return [];
  }

  if (glob.includes("*")) {
    return listChildDirs(parentDir);
  }

  const stat = statSync(parentDir);
  return stat.isDirectory() ? [parentDir] : [];
}

export function resolveWorkspaceGlobs(
  repoPath: string,
  globs: string[]
): string[] {
  const dirs: string[] = [];

  for (const glob of globs) {
    if (glob.startsWith("!")) {
      continue;
    }
    dirs.push(...resolveGlob(repoPath, glob));
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
