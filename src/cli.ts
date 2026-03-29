#!/usr/bin/env bun
/**
 * @module cli
 *
 * CLI entry point. Imports the {@link main} function from {@link ./index} and
 * invokes it, forwarding any unhandled rejections to the process error handler.
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
