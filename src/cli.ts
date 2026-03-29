#!/usr/bin/env -S node --experimental-strip-types
/**
 * @module cli
 *
 * CLI entry point. Imports the {@link main} function from {@link ./index},
 * invokes it, and catches any rejected promise to log the error and exit
 * the process with code 1.
 */
import { main } from "./index.ts";

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
