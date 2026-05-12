#!/usr/bin/env node
/**
 * @module cli
 *
 * CLI entry point. Imports the {@link main} function from {@link ./index},
 * invokes it, and catches any rejected promise to log the error and exit
 * the process with code 1.
 */
import { main } from "./index.ts";
import { selfHealWindowsManifest } from "./windows-manifest.ts";

// `bun add -g` skips lifecycle scripts by default, so the postinstall
// manifest may not have been written. Self-heal on first invocation.
selfHealWindowsManifest();

main().catch((err) => {
  if (err instanceof Error) {
    console.error("Error:", err.message);
    if (err.stack) {
      console.error(err.stack);
    }
  } else {
    console.error("Uncaught error:", err);
  }
  process.exit(1);
});
