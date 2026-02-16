import { main } from "./index.ts";

main().catch((err) => {
  console.error("Uncaught error in main:", err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
