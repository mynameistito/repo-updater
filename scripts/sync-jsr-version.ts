#!/usr/bin/env bun
/**
 * Syncs the version and dependencies from package.json into deno.json.
 * Run after `changeset version` to keep JSR in sync.
 *
 * - version: copied directly
 * - dependencies: mapped to npm: specifiers in deno.json imports
 */

import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const deno = JSON.parse(readFileSync("deno.json", "utf-8"));

if (!pkg.version) {
  console.error("Error: package.json does not contain a version field.");
  process.exit(1);
}

deno.version = pkg.version;

const deps: Record<string, string> = pkg.dependencies ?? {};
const imports: Record<string, string> = {};
for (const [name, version] of Object.entries(deps)) {
  imports[name] = `npm:${name}@${version}`;
}
deno.imports = imports;

writeFileSync("deno.json", `${JSON.stringify(deno, null, 2)}\n`);
