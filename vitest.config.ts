import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "bun:test": path.resolve("./__tests__/bun-test-compat.ts"),
    },
  },
  test: {
    include: ["__tests__/**/*.test.ts"],
    // cli.test.ts uses bun:test's mock.module() for ESM module mocking,
    // which requires Bun's module system and cannot be shimmed for Node.
    exclude: ["__tests__/cli.test.ts"],
  },
});
