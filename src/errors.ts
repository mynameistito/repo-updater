/**
 * @module errors
 *
 * Defines all domain-specific error types used throughout repo-updater.
 * Each error extends {@link TaggedError} from `better-result` with a unique
 * `_tag` for type discrimination in `Result` error handling.
 */

import { TaggedError as createTaggedError } from "better-result";
import type { TaggedErrorClass } from "better-result";

/**
 * Error thrown when a required directory does not exist on the filesystem.
 *
 * @property {string} message - Human-readable error description.
 * @property {string} path - The directory path that was not found.
 */
export const DirectoryNotFoundError: TaggedErrorClass<
  "DirectoryNotFoundError",
  { message: string; path: string }
> = createTaggedError("DirectoryNotFoundError")<{
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
 * @property {string} message - Human-readable error description.
 * @property {string} command - The full command string that was executed.
 * @property {string} stderr - Captured standard error output from the failed process.
 */
export const CommandFailedError: TaggedErrorClass<
  "CommandFailedError",
  { message: string; command: string; stderr: string }
> = createTaggedError("CommandFailedError")<{
  message: string;
  command: string;
  stderr: string;
}>();
/** Instance type for {@link CommandFailedError}. */
export type CommandFailedError = InstanceType<typeof CommandFailedError>;

/**
 * Error thrown when no configuration file can be found at any of the searched paths.
 *
 * @property {string} message - Human-readable error description.
 */
export const ConfigNotFoundError: TaggedErrorClass<
  "ConfigNotFoundError",
  { message: string }
> = createTaggedError("ConfigNotFoundError")<{
  message: string;
}>();
/** Instance type for {@link ConfigNotFoundError}. */
export type ConfigNotFoundError = InstanceType<typeof ConfigNotFoundError>;

/**
 * Error thrown when a configuration file exists but fails validation or JSON parsing.
 *
 * @property {string} message - Human-readable error description.
 */
export const ConfigParseError: TaggedErrorClass<
  "ConfigParseError",
  { message: string }
> = createTaggedError("ConfigParseError")<{
  message: string;
}>();
/** Instance type for {@link ConfigParseError}. */
export type ConfigParseError = InstanceType<typeof ConfigParseError>;

/**
 * Error thrown when user-supplied input (CLI flags, config values) fails validation.
 *
 * @property {string} message - Human-readable error description.
 */
export const InvalidInputError: TaggedErrorClass<
  "InvalidInputError",
  { message: string }
> = createTaggedError("InvalidInputError")<{
  message: string;
}>();
/** Instance type for {@link InvalidInputError}. */
export type InvalidInputError = InstanceType<typeof InvalidInputError>;
