#!/usr/bin/env node
/**
 * @module cli
 *
 * CLI entry point. Imports the {@link main} function from {@link ./index},
 * invokes it, and catches any rejected promise to log the error and exit
 * the process with code 1.
 */
import { main } from "./index.ts";

// `bun add -g` ignores the #!/usr/bin/env node shebang and runs this file
// under Bun's runtime. On Windows, Bun's node:child_process does not honour
// windowsHide, so spawning cmd.exe for URL opening creates a visible console
// window and triggers UAC prompts. Re-exec immediately under Node.js instead.
if (typeof globalThis.Bun !== "undefined" && process.platform === "win32") {
  const { exitCode } = Bun.spawnSync(["node", ...process.argv.slice(1)], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(exitCode ?? 1);
}

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
