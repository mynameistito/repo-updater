/**
 * @module config
 *
 * Configuration file loading, validation, and persistence. Supports both
 * local (`./repo-updater.config.json`) and global
 * (`~/.config/repo-updater/config.json`) config locations. All operations
 * return {@link Result} types for composable error handling.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Result } from "better-result";
import { ConfigNotFoundError, ConfigParseError } from "./errors.ts";

/**
 * User configuration loaded from `repo-updater.config.json`.
 *
 * @property browser - Preferred browser for opening PR URLs (auto-detected if omitted).
 * @property repos - List of local filesystem paths to Git repositories to update.
 */
export interface Config {
  browser?: string;
  repos: string[];
}

/** The default configuration file name searched for in CWD and global config directories. */
const CONFIG_FILENAME = "repo-updater.config.json";

/**
 * Resolves a configuration file path. When `configPath` is provided, only that
 * explicit path is checked (no fallback to CWD or global locations).
 *
 * @param configPath - Explicit path to check. When omitted, the current
 *   working directory and global config directory are searched in order.
 * @returns The absolute path to the found config file, or `null` if none exists.
 */
export function findConfigPath(configPath?: string): string | null {
  const candidates = configPath
    ? [configPath]
    : [
        join(process.cwd(), CONFIG_FILENAME),
        join(homedir(), ".config", "repo-updater", "config.json"),
      ];

  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * Persists the given browser preference to the configuration file.
 *
 * If a config file already exists at the resolved path, it is read, the
 * `browser` field is updated, and the file is rewritten. If no config exists,
 * a new one is created with the given browser value and an empty `repos` array.
 *
 * @param browser - The browser command name to persist (e.g. `"firefox"`, `"chrome"`).
 * @param configPath - Optional explicit config path. Falls back to
 *   {@link findConfigPath} and then the default location.
 * @returns `Ok` with the path to the written config file, or `Err` with a
 *   {@link ConfigParseError} if the existing config cannot be parsed.
 *
 * @example
 * ```ts
 * const result = saveBrowserToConfig("firefox");
 * if (Result.isOk(result)) console.log("Saved to", result.value);
 * ```
 */
export function saveBrowserToConfig(
  browser: string,
  configPath?: string
): Result<string, ConfigParseError> {
  const found = findConfigPath(configPath);

  if (found) {
    return Result.try({
      try: () => {
        const raw = JSON.parse(readFileSync(found, "utf-8")) as Record<
          string,
          unknown
        >;
        raw.browser = browser;
        writeFileSync(found, `${JSON.stringify(raw, null, 2)}\n`);
        return found;
      },
      catch: (e) =>
        new ConfigParseError({
          message: `Failed to update ${found}: ${e instanceof Error ? e.message : String(e)}`,
        }),
    });
  }

  // No config exists — create one at the explicit path or the default location
  const target =
    configPath ?? join(homedir(), ".config", "repo-updater", "config.json");

  return Result.try({
    try: () => {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(
        target,
        `${JSON.stringify({ browser, repos: [] }, null, 2)}\n`
      );
      return target;
    },
    catch: (e) =>
      new ConfigParseError({
        message: `Failed to create ${target}: ${e instanceof Error ? e.message : String(e)}`,
      }),
  });
}

/**
 * Reads and validates a configuration file from the resolved path.
 *
 * The file must contain a `repos` field with a `string[]` value. An optional
 * `browser` field (if present) must be a `string`. Returns a descriptive error
 * if the file is missing, cannot be parsed as JSON, or fails validation.
 *
 * @param configPath - Optional explicit config path. Falls back to
 *   {@link findConfigPath} for automatic discovery.
 * @returns `Ok` with the validated {@link Config}, or `Err` with
 *   {@link ConfigNotFoundError} if no file is found, or {@link ConfigParseError}
 *   if the file is malformed.
 *
 * @example
 * ```ts
 * const result = loadConfig();
 * if (Result.isErr(result)) {
 *   console.error(result.error.message);
 * }
 * ```
 */
export function loadConfig(
  configPath?: string
): Result<Config, ConfigNotFoundError | ConfigParseError> {
  const found = findConfigPath(configPath);

  if (!found) {
    return Result.err(
      new ConfigNotFoundError({
        message: `Config file not found${configPath ? `: ${configPath}` : ""}`,
      })
    );
  }

  return Result.try({
    try: () => {
      const raw = JSON.parse(readFileSync(found, "utf-8")) as unknown;

      if (
        !raw ||
        typeof raw !== "object" ||
        !("repos" in raw) ||
        !Array.isArray((raw as { repos: unknown }).repos) ||
        !(raw as { repos: unknown[] }).repos.every(
          (r: unknown) => typeof r === "string"
        )
      ) {
        throw new Error("Config must contain a 'repos' array");
      }

      if (
        "browser" in raw &&
        typeof (raw as { browser: unknown }).browser !== "string"
      ) {
        throw new Error("'browser' must be a string");
      }

      return raw as Config;
    },
    catch: (e) =>
      new ConfigParseError({
        message: `Failed to parse ${found}: ${e instanceof Error ? e.message : String(e)}`,
      }),
  });
}

/**
 * Partitions repository paths into valid, missing, and non-git directories.
 *
 * Checks each path in order: first whether the directory exists, then whether
 * it contains a `.git` subdirectory (indicating a Git repository).
 *
 * @param repos - Array of repository paths to validate.
 * @returns An object with three arrays: `valid` (existing Git repos),
 *   `missing` (directories that do not exist), and `notGit` (directories
 *   that exist but are not Git repositories).
 */
export function validateRepos(repos: string[]): {
  valid: string[];
  missing: string[];
  notGit: string[];
} {
  const valid: string[] = [];
  const missing: string[] = [];
  const notGit: string[] = [];

  for (const repo of repos) {
    if (!existsSync(repo)) {
      missing.push(repo);
    } else if (existsSync(join(repo, ".git"))) {
      valid.push(repo);
    } else {
      // Repo directory exists but is not a git repository
      notGit.push(repo);
    }
  }

  return { valid, missing, notGit };
}
