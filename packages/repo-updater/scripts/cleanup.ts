#!/usr/bin/env bun
/**
 * Cleanup script to remove temporary files
 * Cross-platform replacement for Unix find command
 */

import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const TARGET_PATTERNS = [/^tmpclaude-/, /^nul$/];
const SKIP_DIRS = new Set(["node_modules", ".git"]);

function shouldDeleteFile(filename: string): boolean {
  return TARGET_PATTERNS.some((pattern) => pattern.test(filename));
}

function shouldSkipDir(dirname: string): boolean {
  return SKIP_DIRS.has(dirname);
}

async function cleanup(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const entryName = String(entry.name);
    const fullPath = join(dir, entryName);

    if (entry.isDirectory()) {
      if (!shouldSkipDir(entryName)) {
        await cleanup(fullPath);
      }
    } else if (entry.isFile() && shouldDeleteFile(entryName)) {
      await unlink(fullPath).catch(() => {
        // Ignore errors - file may already be deleted
      });
    }
  }
}

(async () => {
  await cleanup(".");
})();
