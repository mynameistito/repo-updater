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
