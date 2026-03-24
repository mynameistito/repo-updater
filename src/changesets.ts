import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

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
  const deps = pkg.dependencies;
  if (typeof deps !== "object" || deps === null) {
    return {};
  }
  return { ...(deps as Record<string, string>) };
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
    return readdirSync(changesetDir).filter(
      (f) => f.endsWith(".md") && f !== "README.md"
    );
  } catch {
    return [];
  }
}

export function writeChangesetFile(
  repoPath: string,
  packageName: string,
  changes: DepChange[],
  timestamp: number
): void {
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
