import * as BunTest from "bun:test";

import { getDate, parseArgs } from "../src/args.ts";

let originalConsoleError: typeof console.error;

BunTest.beforeEach(() => {
  originalConsoleError = console.error;
  console.error = () => {
    // Suppress console errors in tests
  };
});

BunTest.afterEach(() => {
  console.error = originalConsoleError;
});

/** Matches a `YYYY-MM-DD` date string. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

BunTest.describe("parseArgs", () => {
  BunTest.test("--help sets help to true", () => {
    const args = parseArgs(["--help"]);
    BunTest.expect(args.help).toBe(true);
  });

  BunTest.test("-h sets help to true", () => {
    const args = parseArgs(["-h"]);
    BunTest.expect(args.help).toBe(true);
  });

  BunTest.test("--dry-run sets dryRun to true", () => {
    const args = parseArgs(["--dry-run"]);
    BunTest.expect(args.dryRun).toBe(true);
  });

  BunTest.test("-n sets dryRun to true", () => {
    const args = parseArgs(["-n"]);
    BunTest.expect(args.dryRun).toBe(true);
  });

  BunTest.test("-c sets configPath", () => {
    const args = parseArgs(["-c", "my-config.json"]);
    BunTest.expect(args.configPath).toBe("my-config.json");
  });

  BunTest.test("--config sets configPath", () => {
    const args = parseArgs(["--config", "my-config.json"]);
    BunTest.expect(args.configPath).toBe("my-config.json");
  });

  BunTest.test("positional arguments are collected", () => {
    const args = parseArgs(["/path/to/repo1", "/path/to/repo2"]);
    BunTest.expect(args.positional).toEqual([
      "/path/to/repo1",
      "/path/to/repo2",
    ]);
  });

  BunTest.test("--minor sets minor to true", () => {
    const args = parseArgs(["--minor"]);
    BunTest.expect(args.minor).toBe(true);
  });

  BunTest.test("-m sets minor to true", () => {
    const args = parseArgs(["-m"]);
    BunTest.expect(args.minor).toBe(true);
  });

  BunTest.test("minor defaults to false", () => {
    const args = parseArgs([]);
    BunTest.expect(args.minor).toBe(false);
  });

  BunTest.test("combined flags work together", () => {
    const args = parseArgs(["-n", "-c", "foo", "bar", "baz"]);
    BunTest.expect(args.dryRun).toBe(true);
    BunTest.expect(args.configPath).toBe("foo");
    BunTest.expect(args.positional).toEqual(["bar", "baz"]);
    BunTest.expect(args.help).toBe(false);
  });

  BunTest.test("leaves configPath undefined when -c is last argument", () => {
    const args = parseArgs(["-c"]);
    BunTest.expect(args.configPath).toBeUndefined();
  });

  BunTest.test("ignores unknown flags", () => {
    const args = parseArgs(["--unknown"]);
    BunTest.expect(args.help).toBe(false);
    BunTest.expect(args.dryRun).toBe(false);
    BunTest.expect(args.configPath).toBeUndefined();
    BunTest.expect(args.positional).toEqual([]);
  });

  BunTest.test("handles -c without value gracefully", () => {
    const args = parseArgs(["-c"]);
    BunTest.expect(args.configPath).toBeUndefined();
  });

  BunTest.test("--no-changeset sets noChangeset to true", () => {
    const args = parseArgs(["--no-changeset"]);
    BunTest.expect(args.noChangeset).toBe(true);
  });

  BunTest.test("noChangeset defaults to false", () => {
    const args = parseArgs([]);
    BunTest.expect(args.noChangeset).toBe(false);
  });

  BunTest.test("--no-workspaces sets noWorkspaces to true", () => {
    const args = parseArgs(["--no-workspaces"]);
    BunTest.expect(args.noWorkspaces).toBe(true);
  });

  BunTest.test("noWorkspaces defaults to false", () => {
    const args = parseArgs([]);
    BunTest.expect(args.noWorkspaces).toBe(false);
  });

  BunTest.test("--no-changeset and --no-workspaces work together", () => {
    const args = parseArgs([
      "--no-changeset",
      "--no-workspaces",
      "/path/to/repo",
    ]);
    BunTest.expect(args.noChangeset).toBe(true);
    BunTest.expect(args.noWorkspaces).toBe(true);
    BunTest.expect(args.positional).toEqual(["/path/to/repo"]);
  });
});

BunTest.describe("getDate", () => {
  BunTest.test("returns date in YYYY-MM-DD format", () => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yyyy = now.getFullYear();
    const expectedDateString = `${yyyy}-${mm}-${dd}`;

    const date = getDate();
    BunTest.expect(date).toMatch(DATE_PATTERN);
    BunTest.expect(date).toBe(expectedDateString);
  });
});
