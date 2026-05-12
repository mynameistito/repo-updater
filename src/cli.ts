#!/usr/bin/env node
/**
 * @module cli
 *
 * CLI entry point. Imports the {@link main} function from {@link ./index},
 * invokes it, and catches any rejected promise to log the error and exit
 * the process with code 1.
 */
import { main } from "./index.ts";
import { ensureWindowsManifest } from "./windows-manifest.ts";

// Drop external asInvoker manifest next to the bun-generated `.exe` shim on
// Windows so subsequent launches do not trigger UAC. First launch under bun
// still UACs (the OS evaluates the binary before any code runs); from then on
// it is silent. No-op on non-Windows. See windows-manifest.ts for context.
ensureWindowsManifest();

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
