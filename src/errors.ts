/**
 * @module errors
 *
 * Defines all domain-specific error types used throughout repo-updater.
 * Each error extends {@link TaggedError} from `better-result` with a unique
 * `_tag` for type discrimination in `Result` error handling.
 */

import { TaggedError, type TaggedErrorClass } from "better-result";

/**
 * Error thrown when a required directory does not exist on the filesystem.
 *
 * @property message - Human-readable error description.
 * @property path - The directory path that was not found.
 */
export const DirectoryNotFoundError: TaggedErrorClass<
  "DirectoryNotFoundError",
  { message: string; path: string }
> = TaggedError("DirectoryNotFoundError")<{
  message: string;
  path: string;
}>();
/** Instance type for {@link DirectoryNotFoundError}. */
export type DirectoryNotFoundError = InstanceType<
  typeof DirectoryNotFoundError
>;

/**
 * Error thrown when a spawned child process exits with a non-zero code.
 *
 * @property message - Human-readable error description.
 * @property command - The full command string that was executed.
 * @property stderr - Captured standard error output from the failed process.
 */
export const CommandFailedError: TaggedErrorClass<
  "CommandFailedError",
  { message: string; command: string; stderr: string }
> = TaggedError("CommandFailedError")<{
  message: string;
  command: string;
  stderr: string;
}>();
/** Instance type for {@link CommandFailedError}. */
export type CommandFailedError = InstanceType<typeof CommandFailedError>;

/**
 * Error thrown when no configuration file can be found at any of the searched paths.
 *
 * @property message - Human-readable error description.
 */
export const ConfigNotFoundError: TaggedErrorClass<
  "ConfigNotFoundError",
  { message: string }
> = TaggedError("ConfigNotFoundError")<{
  message: string;
}>();
/** Instance type for {@link ConfigNotFoundError}. */
export type ConfigNotFoundError = InstanceType<typeof ConfigNotFoundError>;

/**
 * Error thrown when a configuration file exists but fails validation or JSON parsing.
 *
 * @property message - Human-readable error description.
 */
export const ConfigParseError: TaggedErrorClass<
  "ConfigParseError",
  { message: string }
> = TaggedError("ConfigParseError")<{
  message: string;
}>();
/** Instance type for {@link ConfigParseError}. */
export type ConfigParseError = InstanceType<typeof ConfigParseError>;

/**
 * Error thrown when user-supplied input (CLI flags, config values) fails validation.
 *
 * @property message - Human-readable error description.
 */
export const InvalidInputError: TaggedErrorClass<
  "InvalidInputError",
  { message: string }
> = TaggedError("InvalidInputError")<{
  message: string;
}>();
/** Instance type for {@link InvalidInputError}. */
export type InvalidInputError = InstanceType<typeof InvalidInputError>;
