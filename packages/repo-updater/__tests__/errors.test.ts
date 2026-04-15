import { describe, expect, test } from "bun:test";
import { TaggedError } from "better-result";
import {
  CommandFailedError,
  ConfigNotFoundError,
  ConfigParseError,
  DirectoryNotFoundError,
} from "../src/errors.ts";

describe("TaggedError construction", () => {
  test("ConfigNotFoundError has correct _tag and message", () => {
    const err = new ConfigNotFoundError({ message: "not found" });
    expect(err._tag).toBe("ConfigNotFoundError");
    expect(err.message).toBe("not found");
    expect(err).toBeInstanceOf(Error);
  });

  test("ConfigParseError has correct _tag and message", () => {
    const err = new ConfigParseError({ message: "bad json" });
    expect(err._tag).toBe("ConfigParseError");
    expect(err.message).toBe("bad json");
  });

  test("CommandFailedError has correct _tag and properties", () => {
    const err = new CommandFailedError({
      message: "git failed",
      command: "git status",
      stderr: "fatal: not a repo",
    });
    expect(err._tag).toBe("CommandFailedError");
    expect(err.message).toBe("git failed");
    expect(err.command).toBe("git status");
    expect(err.stderr).toBe("fatal: not a repo");
  });

  test("DirectoryNotFoundError has correct _tag and properties", () => {
    const err = new DirectoryNotFoundError({
      message: "dir missing",
      path: "/tmp/nope",
    });
    expect(err._tag).toBe("DirectoryNotFoundError");
    expect(err.path).toBe("/tmp/nope");
  });
});

describe("TaggedError.is()", () => {
  test("ConfigNotFoundError.is() matches own instances", () => {
    const err = new ConfigNotFoundError({ message: "not found" });
    expect(ConfigNotFoundError.is(err)).toBe(true);
  });

  test("ConfigNotFoundError.is() rejects other error types", () => {
    const err = new ConfigParseError({ message: "parse error" });
    expect(ConfigNotFoundError.is(err)).toBe(false);
  });

  test("CommandFailedError.is() matches own instances", () => {
    const err = new CommandFailedError({
      message: "fail",
      command: "echo",
      stderr: "",
    });
    expect(CommandFailedError.is(err)).toBe(true);
  });

  test("CommandFailedError.is() rejects plain Error", () => {
    expect(CommandFailedError.is(new Error("plain"))).toBe(false);
  });

  test("TaggedError.is() matches any tagged error", () => {
    expect(TaggedError.is(new ConfigNotFoundError({ message: "a" }))).toBe(
      true
    );
    expect(
      TaggedError.is(
        new CommandFailedError({
          message: "b",
          command: "c",
          stderr: "d",
        })
      )
    ).toBe(true);
  });

  test("TaggedError.is() rejects non-tagged errors", () => {
    expect(TaggedError.is(new Error("plain"))).toBe(false);
    expect(TaggedError.is({ _tag: "fake" })).toBe(false);
  });
});
