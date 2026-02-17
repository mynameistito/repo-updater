import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDate, parseArgs } from "../src/args.ts";

let originalConsoleError: typeof console.error;

beforeEach(() => {
  originalConsoleError = console.error;
  console.error = () => {};
});

afterEach(() => {
  console.error = originalConsoleError;
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

  test("leaves configPath undefined when -c is last argument", () => {
    const args = parseArgs(["-c"]);
    expect(args.configPath).toBeUndefined();
  });

  test("ignores unknown flags", () => {
    const args = parseArgs(["--unknown"]);
    expect(args.help).toBe(false);
    expect(args.dryRun).toBe(false);
    expect(args.configPath).toBeUndefined();
    expect(args.positional).toEqual([]);
  });

  test("handles -c without value gracefully", () => {
    const args = parseArgs(["-c"]);
    expect(args.configPath).toBeUndefined();
  });
});

describe("getDate", () => {
  test("returns date in YYYY-MM-DD format", () => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yyyy = now.getFullYear();
    const expectedDateString = `${yyyy}-${mm}-${dd}`;

    const date = getDate();
    expect(date).toMatch(DATE_PATTERN);
    expect(date).toBe(expectedDateString);
  });
});
