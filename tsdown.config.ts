import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  platform: "node",
  target: "node22",
  outDir: "dist",
  exports: {
    customExports(pkg) {
      pkg["."] = {
        types: "./dist/index.d.mts",
        import: "./dist/index.mjs",
      };
      pkg["./cli"] = {
        types: "./dist/cli.d.mts",
        import: "./dist/cli.mjs",
      };
      return pkg;
    },
  },
  publint: true,
  deps: {
    neverBundle: ["@clack/prompts", "better-result", "yaml"],
  },
});
