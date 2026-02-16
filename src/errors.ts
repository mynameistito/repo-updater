import { TaggedError } from "better-result";

export const DirectoryNotFoundError = TaggedError("DirectoryNotFoundError")<{
  message: string;
  path: string;
}>();
export type DirectoryNotFoundError = InstanceType<
  typeof DirectoryNotFoundError
>;

export const CommandFailedError = TaggedError("CommandFailedError")<{
  message: string;
  command: string;
  stderr: string;
}>();
export type CommandFailedError = InstanceType<typeof CommandFailedError>;

export const ConfigNotFoundError = TaggedError("ConfigNotFoundError")<{
  message: string;
}>();
export type ConfigNotFoundError = InstanceType<typeof ConfigNotFoundError>;

export const ConfigParseError = TaggedError("ConfigParseError")<{
  message: string;
}>();
export type ConfigParseError = InstanceType<typeof ConfigParseError>;
