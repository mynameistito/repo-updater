#!/usr/bin/env bun
/**
 * Syncs the version from package.json into deno.json
 * Run after `changeset version` to keep JSR in sync
 */

import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const deno = JSON.parse(readFileSync("deno.json", "utf-8"));

if (!pkg.version) {
  console.error("Error: package.json does not contain a version field.");
  process.exit(1);
}

deno.version = pkg.version;

writeFileSync("deno.json", `${JSON.stringify(deno, null, 2)}\n`);
