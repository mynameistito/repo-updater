/**
 * @module index
 *
 * Main orchestrator for repo-updater. Resolves repository paths from CLI
 * arguments and configuration, processes each repository for dependency
 * updates, and opens created PR URLs in the system browser via `./browser`.
 */

import { basename } from "node:path";
import {
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  spinner,
} from "@clack/prompts";
import { getDate, type ParsedArgs, parseArgs } from "./args.ts";
import { openURLs } from "./browser.ts";
import {
  type Config,
  loadConfig,
  saveBrowserToConfig,
  validateRepos,
} from "./config.ts";
import { updateRepo } from "./runner.ts";

// biome-ignore lint/performance/noBarrelFile: preserve public API surface from before browser.ts split
export {
  detectBrowser,
  type ExecFn,
  openURLBun,
  openURLNodejs,
  openURLs,
} from "./browser.ts";

/**
 * Prints CLI usage information and available flags to standard output.
 */
export function printUsage() {
  console.log(`
Usage: repo-updater [options] [repo paths...]

Options:
  -h, --help           Show this help message
  -n, --dry-run        Print steps without executing
  -m, --minor          Only update minor/patch versions (avoid breaking changes)
  -c, --config <path>  Path to config file
  -b, --browser <path> Path to browser executable (e.g. brave.exe)
  --no-changeset       Skip changeset creation
  --no-workspaces      Skip workspace detection (update root only)

Examples:
  repo-updater                              # Update all repos from config
  repo-updater --dry-run                    # Preview without executing
  repo-updater --minor                      # Only minor/patch updates
  repo-updater -c ./my-config.json          # Use custom config
  repo-updater -b "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
  repo-updater E:\\GitHub\\org\\repo1          # Update specific repos
`);
}

/**
 * Resolves the list of repository paths from CLI arguments and configuration.
 *
 * If positional arguments are provided, they are used directly. Otherwise,
 * falls back to the `repos` array from the configuration file.
 *
 * @param args - The parsed CLI arguments.
 * @returns An object with `repos` and optional `config`, or `null` if
 *   no config was found and no positional arguments were given.
 */
export function resolveRepos(
  args: ParsedArgs
): { repos: string[]; config?: Config } | null {
  if (args.positional.length > 0) {
    const configResult = loadConfig(args.configPath);
    const config = configResult.isOk() ? configResult.value : undefined;
    return { repos: args.positional, config };
  }

  const configResult = loadConfig(args.configPath);

  if (configResult.isErr()) {
    log.error(configResult.error.message);
    note(
      JSON.stringify(
        {
          repos: ["/path/to/repo-one", "/path/to/repo-two"],
        },
        null,
        2
      ),
      "Expected config format"
    );
    return null;
  }

  return { repos: configResult.value.repos, config: configResult.value };
}

/**
 * Processes a single repository for dependency updates.
 *
 * Handles both dry-run and live modes. In live mode, delegates to
 * {@link updateRepo} (or a custom `updateFn`). Collects PR URLs for
 * later display.
 *
 * @param repo - Filesystem path to the repository.
 * @param date - Date string for branch naming (from {@link getDate}).
 * @param dryRun - When `true`, only simulates the update.
 * @param updateFn - Optional custom update function (defaults to {@link updateRepo}).
 * @param minor - When `true`, restricts updates to the current minor range.
 * @param noChangeset - When `true`, skips changeset generation.
 * @param noWorkspaces - When `true`, skips workspace-aware updates.
 * @returns A result object with `repo`, `status`, and optional `prUrl`.
 */
export async function processRepo(
  repo: string,
  date: string,
  dryRun: boolean,
  updateFn: typeof updateRepo = updateRepo,
  minor = false,
  noChangeset = false,
  noWorkspaces = false
): Promise<{
  repo: string;
  status: "pr-created" | "no-changes" | "failed";
  prUrl?: string;
}> {
  const repoName = basename(repo);
  log.step(repoName);

  if (dryRun) {
    const result = await updateFn({
      repo,
      date,
      dryRun: true,
      minor,
      noChangeset,
      noWorkspaces,
    });
    console.log();
    return result.isOk() ? result.value : { repo, status: "failed" };
  }

  const s = spinner();
  s.start("Updating dependencies...");

  const result = await updateFn({
    repo,
    date,
    dryRun: false,
    minor,
    noChangeset,
    noWorkspaces,
  });

  if (result.isErr()) {
    s.stop(`Failed: ${repoName}`);
    log.error(`${repoName}: ${result.error.message}`);
    if ("stderr" in result.error && result.error.stderr) {
      log.error(result.error.stderr);
    }
    return { repo, status: "failed" };
  }

  const { status, prUrl } = result.value;

  if (status === "no-changes") {
    s.stop(`No changes: ${repoName}`);
    log.info(`${repoName}: No dependency changes`);
  } else {
    s.stop(`Done: ${repoName}`);
    if (prUrl) {
      log.success(`${repoName}: ${prUrl}`);
    } else {
      log.success(repoName);
    }
  }

  return result.value;
}

/**
 * Aggregates all parameters needed to process a single repository.
 *
 * @property date - Date string for branch naming.
 * @property dryRun - Whether to simulate the update.
 * @property minor - Restrict to minor-range updates.
 * @property noChangeset - Skip changeset generation.
 * @property noWorkspaces - Skip workspace-aware logic.
 * @property prUrls - Shared array to collect created PR URLs.
 * @property updateFn - Custom update function override.
 * @property valid - Validated repository paths to process.
 */
interface RepoProcessingOptions {
  date: string;
  dryRun: boolean;
  minor: boolean;
  noChangeset: boolean;
  noWorkspaces: boolean;
  prUrls: string[];
  updateFn: typeof updateRepo;
  valid: string[];
}

/**
 * Executes the repository update and collects the resulting PR URL.
 *
 * @param options - The {@link RepoProcessingOptions} for this repository.
 */
async function handleRepoProcessing({
  valid,
  date,
  dryRun,
  prUrls,
  updateFn,
  minor,
  noChangeset,
  noWorkspaces,
}: RepoProcessingOptions) {
  for (const repo of valid) {
    const result = await processRepo(
      repo,
      date,
      dryRun,
      updateFn,
      minor,
      noChangeset,
      noWorkspaces
    );
    if (result.prUrl) {
      prUrls.push(result.prUrl);
    }
  }
}

/**
 * Displays collected PR URLs and offers to open them in the browser.
 *
 * @param prUrls - Array of PR URLs created during the run.
 */
async function handlePRDisplay(prUrls: string[]) {
  note(prUrls.join("\n"), "Pull Requests");

  const shouldOpen = await confirm({
    message: "Open all PR URLs in browser?",
  });

  if (isCancel(shouldOpen)) {
    outro("Cancelled.");
    process.exit(0);
  }

  return shouldOpen === true;
}

/**
 * Main entry point for repo-updater.
 *
 * Parses CLI arguments, loads configuration, validates repositories, and
 * processes each repository for dependency updates. Supports interactive
 * browser selection, dry-run mode, and automatic PR URL opening.
 *
 * @param argv - Raw CLI arguments (defaults to `process.argv.slice(2)`).
 * @param updateFn - Optional custom update function for testing or programmatic use.
 *
 * @example
 * ```ts
 * // Run with default arguments
 * await main();
 *
 * // Run with custom arguments and updater
 * await main(["--dry-run", "./my-repo"], myUpdateFn);
 * ```
 */
async function maybeOpenPRs(prUrls: string[], browser?: string) {
  const shouldOpen = await handlePRDisplay(prUrls);
  if (!shouldOpen) {
    return;
  }
  log.info(`Using browser: ${browser ?? "auto-detected"}`);
  try {
    await openURLs(prUrls, process.platform, undefined, browser);
  } catch (err) {
    log.warn(
      `Failed to open ${prUrls.length} PR URL(s) in browser ${browser ?? "(auto)"}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function main(
  argv?: string[],
  updateFn: typeof updateRepo = updateRepo
) {
  const args = parseArgs(argv ?? process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  intro("repo-updater");

  const resolved = resolveRepos(args);
  if (!resolved) {
    outro("Exiting.");
    process.exit(1);
  }

  const { valid, missing, notGit } = validateRepos(resolved.repos);

  const browser = args.browser ?? resolved.config?.browser;

  if (args.browser) {
    const saved = saveBrowserToConfig(args.browser, args.configPath);
    if (saved.isOk()) {
      log.info(`Browser saved to ${saved.value}`);
    }
  }

  for (const m of missing) {
    log.warn(`Directory not found: ${m}`);
  }

  for (const ng of notGit) {
    log.warn(`Not a git repository: ${ng}`);
  }

  if (valid.length === 0) {
    log.error("No valid repositories found.");
    outro("Exiting.");
    process.exit(1);
  }

  const date = getDate();
  const prUrls: string[] = [];

  if (args.dryRun) {
    log.info("[dry-run] No commands will be executed.\n");
  }

  await handleRepoProcessing({
    valid,
    date,
    dryRun: args.dryRun,
    prUrls,
    updateFn,
    minor: args.minor,
    noChangeset: args.noChangeset,
    noWorkspaces: args.noWorkspaces,
  });

  if (prUrls.length > 0) {
    await maybeOpenPRs(prUrls, browser);
  } else if (!args.dryRun) {
    log.info("No pull requests were created.");
  }

  outro("Done!");
}
