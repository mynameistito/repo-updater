/**
 * @module package-json
 *
 * Utility for reading and parsing {@code package.json} files from a directory.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Reads and parses the {@code package.json} from the given directory.
 *
 * @param dir - Absolute or relative path to the directory containing {@code package.json}.
 * @returns The parsed JSON object, or {@code null} if the file does not exist or cannot be parsed.
 */
export const readPackageJson = (
  dir: string
): Record<string, unknown> | null => {
  const pkgPath = path.join(dir, "package.json");
  if (!existsSync(pkgPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
};
