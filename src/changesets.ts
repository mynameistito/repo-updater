import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { WorkspacePackage } from "./workspaces.ts";

export interface DepSnapshot {
  [pkg: string]: string;
}

export interface DepChange {
  from: string;
  name: string;
  to: string;
}

function readPackageJson(repoPath: string): Record<string, unknown> | null {
  const pkgPath = join(repoPath, "package.json");
  if (!existsSync(pkgPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function hasChangesets(repoPath: string): boolean {
  if (existsSync(join(repoPath, ".changeset", "config.json"))) {
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
}

export function snapshotDeps(repoPath: string): DepSnapshot {
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
}

export function diffDeps(before: DepSnapshot, after: DepSnapshot): DepChange[] {
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: DepChange[] = [];

  for (const name of allKeys) {
    const from = before[name] ?? "";
    const to = after[name] ?? "";
    if (from !== to) {
      changes.push({ name, from, to });
    }
  }

  return changes.sort((a, b) => a.name.localeCompare(b.name));
}

export function getChangesetFiles(repoPath: string): string[] {
  const changesetDir = join(repoPath, ".changeset");
  if (!existsSync(changesetDir)) {
    return [];
  }
  try {
    return readdirSync(changesetDir)
      .filter((f) => f.endsWith(".md") && f !== "README.md")
      .sort();
  } catch {
    return [];
  }
}

export function getPackageName(repoPath: string): string {
  const pkg = readPackageJson(repoPath);
  if (!pkg) {
    return "unknown";
  }
  const name = pkg.name;
  return typeof name === "string" ? name : "unknown";
}

export function writeChangesetFile(
  repoPath: string,
  packageName: string,
  changes: DepChange[],
  timestamp: number
): void {
  if (changes.length === 0) {
    return;
  }

  const changesetDir = join(repoPath, ".changeset");
  if (!existsSync(changesetDir)) {
    mkdirSync(changesetDir, { recursive: true });
  }

  const bullets = changes
    .map((c) => `- ${c.name}: ${c.from || "(new)"} → ${c.to || "(removed)"}`)
    .join("\n");

  const content = `---\n"${packageName}": patch\n---\n\nUpdated dependencies:\n${bullets}\n`;

  writeFileSync(
    join(changesetDir, `dep-updates-${timestamp}.md`),
    content,
    "utf8"
  );
}

export function snapshotWorkspaceDeps(
  repoPath: string,
  packages: WorkspacePackage[]
): Map<string, DepSnapshot> {
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
}

export function diffWorkspaceDeps(
  before: Map<string, DepSnapshot>,
  after: Map<string, DepSnapshot>
): Map<string, DepChange[]> {
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
}

export function writeWorkspaceChangesetFile(
  repoPath: string,
  changedPackages: Map<string, DepChange[]>,
  timestamp: number
): void {
  if (changedPackages.size === 0) {
    return;
  }

  const changesetDir = join(repoPath, ".changeset");
  if (!existsSync(changesetDir)) {
    mkdirSync(changesetDir, { recursive: true });
  }

  // Build frontmatter with all changed packages
  const frontmatterLines = [...changedPackages.keys()]
    .sort()
    .map((name) => `"${name}": patch`);

  // Build body with per-package change details
  const bodyParts: string[] = [];
  for (const [name, changes] of [...changedPackages.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const bullets = changes
      .map((c) => `- ${c.name}: ${c.from || "(new)"} → ${c.to || "(removed)"}`)
      .join("\n");
    bodyParts.push(`**${name}**:\n${bullets}`);
  }

  const content = `---\n${frontmatterLines.join("\n")}\n---\n\nUpdated dependencies:\n${bodyParts.join("\n\n")}\n`;

  writeFileSync(
    join(changesetDir, `dep-updates-${timestamp}.md`),
    content,
    "utf8"
  );
}
