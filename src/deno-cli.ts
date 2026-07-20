#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net
/**
 * @module deno-cli
 *
 * Deno-specific CLI entry point. Mirrors the behavior of {@link ./cli},
 * but uses a Deno-compatible shebang and {@link Deno.exit} instead of
 * `process.exit` so that binaries installed via `deno install` invoke the
 * Deno runtime rather than Node.
 */

import { main } from "./index.ts";

/** Ambient type declaration for the Deno global used by this entry point. */
declare const Deno: {
  /** Command-line arguments passed to the script. */
  readonly args: string[];
  /** Terminate the process with the given status code. */
  exit: (code?: number) => never;
};

const run = async (): Promise<void> => {
  try {
    await main(Deno.args);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
      if (error.stack) {
        console.error(error.stack);
      }
    } else {
      console.error("Uncaught error:", error);
    }
    Deno.exit(1);
  }
};

await run();
