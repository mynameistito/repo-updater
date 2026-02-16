import { describe, expect, test } from "bun:test";
import { getDate, parseArgs } from "../src/args.ts";

const DATE_PATTERN = /^\d{2}-\d{2}-\d{4}$/;

describe("parseArgs", () => {
  test("--help sets help to true", () => {
    const args = parseArgs(["--help"]);
    expect(args.help).toBe(true);
  });

  test("-h sets help to true", () => {
    const args = parseArgs(["-h"]);
    expect(args.help).toBe(true);
  });

  test("--dry-run sets dryRun to true", () => {
    const args = parseArgs(["--dry-run"]);
    expect(args.dryRun).toBe(true);
  });

  test("-n sets dryRun to true", () => {
    const args = parseArgs(["-n"]);
    expect(args.dryRun).toBe(true);
  });

  test("-c sets configPath", () => {
    const args = parseArgs(["-c", "my-config.json"]);
    expect(args.configPath).toBe("my-config.json");
  });

  test("--config sets configPath", () => {
    const args = parseArgs(["--config", "my-config.json"]);
    expect(args.configPath).toBe("my-config.json");
  });

  test("positional arguments are collected", () => {
    const args = parseArgs(["/path/to/repo1", "/path/to/repo2"]);
    expect(args.positional).toEqual(["/path/to/repo1", "/path/to/repo2"]);
  });

  test("combined flags work together", () => {
    const args = parseArgs(["-n", "-c", "foo", "bar", "baz"]);
    expect(args.dryRun).toBe(true);
    expect(args.configPath).toBe("foo");
    expect(args.positional).toEqual(["bar", "baz"]);
    expect(args.help).toBe(false);
  });
});

describe("getDate", () => {
  test("returns date in DD-MM-YYYY format", () => {
    const date = getDate();
    expect(date).toMatch(DATE_PATTERN);
  });
});
