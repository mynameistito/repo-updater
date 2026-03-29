#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const deno = JSON.parse(readFileSync("deno.json", "utf-8"));

if (!pkg.version) {
  console.error("Error: package.json does not contain a version field.");
  process.exit(1);
}

deno.version = pkg.version;

const deps: Record<string, string> = pkg.dependencies ?? {};
const updatedImports: Record<string, string> = { ...deno.imports };
for (const [name, version] of Object.entries(deps)) {
  updatedImports[name] = `npm:${name}@${version}`;
}
deno.imports = updatedImports;

writeFileSync("deno.json", `${JSON.stringify(deno, null, 2)}\n`);
