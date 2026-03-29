import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  shims: true,
  platform: "node",
  outDir: "dist",
  deps: {
    neverBundle: ["@clack/prompts", "better-result", "yaml"],
  },
});
