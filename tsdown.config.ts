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
      pkg["."] = {
        import: "./dist/index.mjs",
        types: "./dist/index.d.mts",
      };
      pkg["./cli"] = {
        import: "./dist/cli.mjs",
        types: "./dist/cli.d.mts",
      };
      return pkg;
    },
  },
  format: ["esm"],
  outDir: "dist",
  platform: "node",
  publint: true,
  target: "node22",
});
