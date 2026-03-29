import { TaggedError, type TaggedErrorClass } from "better-result";

export const DirectoryNotFoundError: TaggedErrorClass<
  "DirectoryNotFoundError",
  { message: string; path: string }
> = TaggedError("DirectoryNotFoundError")<{
  message: string;
  path: string;
}>();
export type DirectoryNotFoundError = InstanceType<
  typeof DirectoryNotFoundError
>;

export const CommandFailedError: TaggedErrorClass<
  "CommandFailedError",
  { message: string; command: string; stderr: string }
> = TaggedError("CommandFailedError")<{
  message: string;
  command: string;
  stderr: string;
}>();
export type CommandFailedError = InstanceType<typeof CommandFailedError>;

export const ConfigNotFoundError: TaggedErrorClass<
  "ConfigNotFoundError",
  { message: string }
> = TaggedError("ConfigNotFoundError")<{
  message: string;
}>();
export type ConfigNotFoundError = InstanceType<typeof ConfigNotFoundError>;

export const ConfigParseError: TaggedErrorClass<
  "ConfigParseError",
  { message: string }
> = TaggedError("ConfigParseError")<{
  message: string;
}>();
export type ConfigParseError = InstanceType<typeof ConfigParseError>;

export const InvalidInputError: TaggedErrorClass<
  "InvalidInputError",
  { message: string }
> = TaggedError("InvalidInputError")<{
  message: string;
}>();
export type InvalidInputError = InstanceType<typeof InvalidInputError>;
