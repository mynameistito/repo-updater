#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net
/**
 * @module deno-cli
 *
 * Deno-specific CLI entry point. Mirrors the behavior of {@link ./cli},
 * but uses a Deno-compatible shebang and {@link Deno.exit} instead of
 * `process.exit` so that binaries installed via `deno install` invoke the
 * Deno runtime rather than Node.
 */

/** Ambient type declaration for the Deno global used by this entry point. */
declare const Deno: {
  /** Command-line arguments passed to the script. */
  readonly args: string[];
  /** Terminate the process with the given status code. */
  exit(code?: number): never;
};

import { main } from "./index.ts";

main(Deno.args).catch((err: unknown) => {
  if (err instanceof Error) {
    console.error("Error:", err.message);
    if (err.stack) {
      console.error(err.stack);
    }
  } else {
    console.error("Uncaught error:", err);
  }
  Deno.exit(1);
});
