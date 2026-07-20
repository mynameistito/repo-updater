import * as BunTest from "bun:test";

import { TaggedError } from "better-result";

import {
  CommandFailedError,
  ConfigNotFoundError,
  ConfigParseError,
  DirectoryNotFoundError,
} from "../src/errors.ts";

BunTest.describe("TaggedError construction", () => {
  BunTest.test("ConfigNotFoundError has correct _tag and message", () => {
    const err = new ConfigNotFoundError({ message: "not found" });
    BunTest.expect(err._tag).toBe("ConfigNotFoundError");
    BunTest.expect(err.message).toBe("not found");
    BunTest.expect(err).toBeInstanceOf(Error);
  });

  BunTest.test("ConfigParseError has correct _tag and message", () => {
    const err = new ConfigParseError({ message: "bad json" });
    BunTest.expect(err._tag).toBe("ConfigParseError");
    BunTest.expect(err.message).toBe("bad json");
  });

  BunTest.test("CommandFailedError has correct _tag and properties", () => {
    const err = new CommandFailedError({
      command: "git status",
      message: "git failed",
      stderr: "fatal: not a repo",
    });
    BunTest.expect(err._tag).toBe("CommandFailedError");
    BunTest.expect(err.message).toBe("git failed");
    BunTest.expect(err.command).toBe("git status");
    BunTest.expect(err.stderr).toBe("fatal: not a repo");
  });

  BunTest.test("DirectoryNotFoundError has correct _tag and properties", () => {
    const err = new DirectoryNotFoundError({
      message: "dir missing",
      path: "/tmp/nope",
    });
    BunTest.expect(err._tag).toBe("DirectoryNotFoundError");
    BunTest.expect(err.path).toBe("/tmp/nope");
  });
});

BunTest.describe("TaggedError.is()", () => {
  BunTest.test("ConfigNotFoundError.is() matches own instances", () => {
    const err = new ConfigNotFoundError({ message: "not found" });
    BunTest.expect(ConfigNotFoundError.is(err)).toBe(true);
  });

  BunTest.test("ConfigNotFoundError.is() rejects other error types", () => {
    const err = new ConfigParseError({ message: "parse error" });
    BunTest.expect(ConfigNotFoundError.is(err)).toBe(false);
  });

  BunTest.test("CommandFailedError.is() matches own instances", () => {
    const err = new CommandFailedError({
      command: "echo",
      message: "fail",
      stderr: "",
    });
    BunTest.expect(CommandFailedError.is(err)).toBe(true);
  });

  BunTest.test("CommandFailedError.is() rejects plain Error", () => {
    BunTest.expect(CommandFailedError.is(new Error("plain"))).toBe(false);
  });

  BunTest.test("TaggedError.is() matches any tagged error", () => {
    BunTest.expect(
      TaggedError.is(new ConfigNotFoundError({ message: "a" }))
    ).toBe(true);
    BunTest.expect(
      TaggedError.is(
        new CommandFailedError({
          command: "c",
          message: "b",
          stderr: "d",
        })
      )
    ).toBe(true);
  });

  BunTest.test("TaggedError.is() rejects non-tagged errors", () => {
    BunTest.expect(TaggedError.is(new Error("plain"))).toBe(false);
    BunTest.expect(TaggedError.is({ _tag: "fake" })).toBe(false);
  });
});
