import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  deps: {
    neverBundle: ["@clack/prompts", "better-result", "yaml"],
  },
  dts: true,
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
  },
  exports: {
    customExports(pkg) {
      pkg["."] = Object.fromEntries([
        ["types", "./dist/index.d.mts"],
        ["import", "./dist/index.mjs"],
      ]);
      pkg["./cli"] = Object.fromEntries([
        ["types", "./dist/cli.d.mts"],
        ["import", "./dist/cli.mjs"],
      ]);
      return pkg;
    },
  },
  format: ["esm"],
  outDir: "dist",
  platform: "node",
  publint: true,
  target: "node22",
});
