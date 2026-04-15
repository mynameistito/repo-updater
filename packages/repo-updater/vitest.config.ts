import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "bun:test": fileURLToPath(
        new URL("./__tests__/bun-test-compat.ts", import.meta.url)
      ),
    },
  },
  test: {
    include: ["__tests__/**/*.test.ts"],
    // cli.test.ts uses bun:test's mock.module() for ESM module mocking,
    // which requires Bun's module system and cannot be shimmed for Node.
    exclude: [...configDefaults.exclude, "__tests__/cli.test.ts"],
  },
});
