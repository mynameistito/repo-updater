import { main } from "./index.ts";

main().catch((err) => {
  console.error("Uncaught error in main:", err);
  process.exit(1);
});
