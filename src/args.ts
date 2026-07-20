/**
 * @module args
 *
 * CLI argument parsing. Converts raw `process.argv` strings into a typed
 * {@link ParsedArgs} object, handling boolean flags, short aliases, and
 * positional repo paths.
 */

/**
 * Represents the fully parsed CLI arguments.
 *
 * @property {string | undefined} browser - Override the auto-detected browser for opening PR URLs.
 * @property {string | undefined} configPath - Explicit path to a config file, overriding default search.
 * @property {boolean} dryRun - When `true`, prints what would happen without making changes.
 * @property {boolean} help - When `true`, prints usage information and exits.
 * @property {boolean} minor - When `true`, restricts dependency updates to the current minor range.
 * @property {boolean} noChangeset - When `true`, skips changeset file generation after updates.
 * @property {boolean} noWorkspaces - When `true`, skips workspace-aware update logic.
 * @property {string[]} positional - Remaining non-flag arguments, interpreted as repo paths.
 */
export interface ParsedArgs {
  browser: string | undefined;
  configPath: string | undefined;
  dryRun: boolean;
  help: boolean;
  minor: boolean;
  noChangeset: boolean;
  noWorkspaces: boolean;
  positional: string[];
}

/** Union of all recognized boolean flag names. */
type BooleanFlag = "help" | "dryRun" | "minor" | "noChangeset" | "noWorkspaces";

/**
 * Maps flag argument strings (both `--kebab-case` and short aliases) to their
 * canonical {@link BooleanFlag} key.
 */
const BOOLEAN_FLAGS: Record<string, BooleanFlag> = {
  "--dry-run": "dryRun",
  "--help": "help",
  "--minor": "minor",
  "--no-changeset": "noChangeset",
  "--no-workspaces": "noWorkspaces",
  "-h": "help",
  "-m": "minor",
  "-n": "dryRun",
};

/**
 * Parses raw CLI arguments into a typed {@link ParsedArgs} object.
 *
 * Recognized boolean flags (`--help`, `--dry-run`, `--minor`, `--no-changeset`,
 * `--no-workspaces`) and their short aliases are extracted. The `--config`
 * and `--browser` flags consume the next argument as their value. All remaining
 * arguments are collected into {@link ParsedArgs.positional}.
 *
 * @param argv - Raw argument strings (typically `process.argv.slice(2)`).
 * @returns The parsed arguments with flags resolved and positional args collected.
 *
 * @example
 * ```ts
 * const args = parseArgs(["--dry-run", "--minor", "./my-repo"]);
 * // args.dryRun === true, args.minor === true, args.positional === ["./my-repo"]
 * ```
 */
export const parseArgs = (argv: string[]): ParsedArgs => {
  const flags: Record<BooleanFlag, boolean> = {
    dryRun: false,
    help: false,
    minor: false,
    noChangeset: false,
    noWorkspaces: false,
  };
  let browser: string | undefined;
  let configPath: string | undefined;
  const positional: string[] = [];

  const iter = argv[Symbol.iterator]();
  for (const arg of iter) {
    const boolFlag = BOOLEAN_FLAGS[arg];
    if (boolFlag) {
      flags[boolFlag] = true;
    } else if (arg === "-c" || arg === "--config") {
      const next = iter.next();
      if (next.done) {
        console.error(`${arg} requires a value`);
      } else {
        configPath = next.value;
      }
    } else if (arg === "-b" || arg === "--browser") {
      const next = iter.next();
      if (next.done) {
        console.error(`${arg} requires a value`);
      } else {
        browser = next.value;
      }
    } else if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  return { ...flags, browser, configPath, positional };
};

/**
 * Returns the current local date formatted as `YYYY-MM-DD`.
 *
 * Used to construct deterministic branch names for dependency update PRs.
 *
 * @returns The date string in ISO calendar format.
 */
export const getDate = (): string => {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
};
