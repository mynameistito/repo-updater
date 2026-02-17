import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Result } from "better-result";
import { ConfigNotFoundError, ConfigParseError } from "./errors.ts";

export interface Config {
  repos: string[];
}

const CONFIG_FILENAME = "repo-updater.config.json";

export function loadConfig(
  configPath?: string
): Result<Config, ConfigNotFoundError | ConfigParseError> {
  const candidates = configPath
    ? [configPath]
    : [
        join(process.cwd(), CONFIG_FILENAME),
        join(homedir(), ".config", "repo-updater", "config.json"),
      ];

  const found = candidates.find((p) => existsSync(p));

  if (!found) {
    return Result.err(
      new ConfigNotFoundError({
        message: `Config file not found. Searched: ${candidates.join(", ")}`,
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

      return raw as Config;
    },
    catch: (e) =>
      new ConfigParseError({
        message: `Failed to parse ${found}: ${e instanceof Error ? e.message : String(e)}`,
      }),
  });
}

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
    } else if (!existsSync(join(repo, ".git"))) {
      // Repo directory exists but is not a git repository
      notGit.push(repo);
    } else {
      valid.push(repo);
    }
  }

  return { valid, missing, notGit };
}
