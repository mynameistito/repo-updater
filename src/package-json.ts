import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function readPackageJson(dir: string): Record<string, unknown> | null {
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
