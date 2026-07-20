#!/usr/bin/env bun
/**
 * Cleanup script to remove temporary files
 * Cross-platform replacement for Unix find command
 */

import { readdir, unlink } from "node:fs/promises";
import path from "node:path";

const TARGET_PATTERNS = [/^tmpclaude-/u, /^nul$/u];
const SKIP_DIRS = new Set(["node_modules", ".git"]);

const shouldDeleteFile = (filename: string): boolean =>
  TARGET_PATTERNS.some((pattern) => pattern.test(filename));

const shouldSkipDir = (dirname: string): boolean => SKIP_DIRS.has(dirname);

const cleanup = async (dir: string): Promise<void> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

  await Promise.all(
    entries.map(async (entry) => {
      const entryName = String(entry.name);
      const fullPath = path.join(dir, entryName);

      if (entry.isDirectory()) {
        if (!shouldSkipDir(entryName)) {
          await cleanup(fullPath);
        }
      } else if (entry.isFile() && shouldDeleteFile(entryName)) {
        await unlink(fullPath).catch(() => {
          // Ignore errors - file may already be deleted
        });
      }
    })
  );
};

(async () => {
  await cleanup(".");
})();
