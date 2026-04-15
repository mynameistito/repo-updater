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

function stringifyWithInlineArrays(obj: unknown, indent = 2): string {
  const raw = JSON.stringify(obj, null, indent);
  // Collapse arrays of primitives (strings/numbers/booleans) onto one line
  return raw.replace(
    /\[\n\s+("(?:[^"\\]|\\.)*"(?:,\n\s+"(?:[^"\\]|\\.)*")*)\n\s+\]/g,
    (_, inner) => {
      const items = inner.replace(/\n\s+/g, " ");
      return `[${items}]`;
    }
  );
}

writeFileSync("deno.json", `${stringifyWithInlineArrays(deno)}\n`);
