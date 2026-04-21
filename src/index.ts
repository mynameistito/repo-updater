/**
 * @module index
 *
 * Main orchestrator for repo-updater. Resolves repository paths from CLI
 * arguments and configuration, processes each repository for dependency
 * updates, and opens created PR URLs in the system browser. Also provides
 * cross-platform browser detection and URL opening utilities.
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
import {
  type Config,
  loadConfig,
  saveBrowserToConfig,
  validateRepos,
} from "./config.ts";
import { execBun, execNodejs, updateRepo } from "./runner.ts";

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
 * Opens a URL using Bun's native `Bun.spawn` (fire-and-forget, the
 * returned subprocess is not awaited).
 *
 * @param cmd - The browser command and arguments.
 */
export function openURLBun(cmd: string[]): void {
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", windowsHide: true });
}

/**
 * Opens a URL using Bun's native `Bun.spawnSync`.
 *
 * @param cmd - The browser command and arguments.
 */
export function openURLBunSync(cmd: string[]): number | null {
  try {
    const proc = Bun.spawnSync(cmd, {
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
    });
    return proc.exitCode;
  } catch (err) {
    console.error(`openURLBunSync failed for ${cmd.join(" ")}:`, err);
    return null;
  }
}

/**
 * Opens a URL using Node.js `child_process.spawn` with `stdio: "ignore"`.
 *
 * @param cmd - The browser command and arguments.
 */
export async function openURLNodejs(cmd: string[]): Promise<void> {
  const { spawn } = await import("node:child_process");
  // Do NOT use detached: true — DETACHED_PROCESS causes CREATE_NO_WINDOW
  // (windowsHide) to be ignored on Windows, letting cmd.exe allocate a new
  // console window and making ShellExecuteEx appear suspicious (UAC prompt).
  const child = spawn(cmd[0], cmd.slice(1), {
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

/**
 * Function signature for executing shell commands.
 *
 * @param cmd - The command and arguments to execute.
 * @param cwd - The working directory for the command.
 * @returns A promise resolving to the command's captured output.
 */
export type ExecFn = (
  cmd: string[],
  cwd: string
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

/** Matches a Windows registry prog ID value from `reg query` output. */
const PROG_ID_REGEX = /ProgId\s+REG_SZ\s+(\S+)/;
/** Matches a `.desktop` file suffix string from `xdg-settings` output. */
const DESKTOP_SUFFIX_REGEX = /\.desktop$/;
/** Matches Firefox's bundle identifier in macOS defaults output. */
const MACOS_FIREFOX_REGEX =
  /LSHandlerURLScheme\s*=\s*https[\s\S]*?LSHandlerRoleAll\s*=\s*"?(org\.mozilla\.firefox)"?/;
/** Matches the HTTP handler prog ID from Windows registry output. */
const REG_COMMAND_REGEX = /\(Default\)\s+REG_SZ\s+"?([^"]+\.exe)"?/i;
/** Matches `.exe` file extension in a Windows path. */
const EXE_SUFFIX_REGEX = /\.exe$/i;

/** Maps Windows HTTP handler prog IDs to browser executable names. */
const windowsProgIdMap: Record<string, string> = {
  ChromeHTML: "chrome",
  MSEdgeHTM: "msedge",
  BraveHTML: "brave",
};

/** Maps `.desktop` file names to browser executable commands. */
const linuxDesktopMap: Record<string, string> = {
  "google-chrome": "google-chrome",
  "google-chrome-stable": "google-chrome-stable",
  firefox: "firefox",
  chromium: "chromium",
  "chromium-browser": "chromium-browser",
  "brave-browser": "brave-browser",
  "microsoft-edge": "microsoft-edge",
};

/**
 * Detects the default browser on macOS by reading `com.apple.LaunchServices`
 * defaults for the `http` URL scheme.
 *
 * @param execFn - Command executor function.
 * @returns The browser command name, or `null` if undetermined.
 */
async function detectMacosBrowser(
  execFn: ExecFn
): Promise<{ browser: string } | null> {
  // Detect if Firefox is the default browser on macOS
  // Firefox enforces single-instance locking, so we need to know
  // whether to use `open -n` (new instance) or just `open`
  try {
    const result = await execFn(
      [
        "defaults",
        "read",
        "com.apple.LaunchServices/com.apple.launchservices.secure",
        "LSHandlers",
      ],
      "."
    );
    if (result.exitCode === 0 && MACOS_FIREFOX_REGEX.test(result.stdout)) {
      return { browser: "firefox" };
    }
  } catch {
    // Fall through
  }
  return null;
}

/**
 * Resolves the full executable path for a Windows browser from its registry prog ID.
 *
 * @param execFn - Command executor function.
 * @returns The absolute path to the browser executable, or `null` if not found.
 */
async function getWindowsDefaultBrowserPath(
  execFn: ExecFn
): Promise<string | null> {
  const psScript = `
    $progId = (Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice" -Name "ProgId" -ErrorAction SilentlyContinue).ProgId
    if ($progId) {
      $cmd = (Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Classes\\$progId\\shell\\open\\command" -ErrorAction SilentlyContinue).'(Default)'
      if ($cmd -match '"([^"]+.exe)"') { $matches[1] }
    }
  `;
  const result = await execFn(
    ["powershell", "-NoProfile", "-Command", psScript.trim()],
    "."
  );
  const path = result.stdout.trim();
  if (result.exitCode === 0 && path && EXE_SUFFIX_REGEX.test(path)) {
    return path;
  }
  return null;
}

/**
 * Detects the default browser on Windows by querying the registry for the
 * HTTP handler prog ID and resolving it to an executable path.
 *
 * @param execFn - Command executor function.
 * @returns The browser executable name, or `null` if undetermined.
 */
async function detectWindowsBrowser(
  execFn: ExecFn
): Promise<{ browser: string; path?: string } | null> {
  // First, try to get the actual browser path using PowerShell
  const browserPath = await getWindowsDefaultBrowserPath(execFn);
  if (browserPath) {
    return { browser: browserPath, path: browserPath };
  }

  // Fallback to registry detection
  const result = await execFn(
    [
      "reg",
      "query",
      "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice",
      "/v",
      "ProgId",
    ],
    "."
  );
  if (result.exitCode !== 0) {
    return null;
  }

  const match = result.stdout.match(PROG_ID_REGEX);
  if (!match) {
    return null;
  }

  const progId = match[1];

  // Get the actual executable path from the ProgId class
  const cmdResult = await execFn(
    [
      "reg",
      "query",
      `HKLM\\SOFTWARE\\Classes\\${progId}\\shell\\open\\command`,
      "/ve",
    ],
    "."
  );
  if (cmdResult.exitCode !== 0) {
    // Fallback to known browser names
    if (progId.startsWith("FirefoxURL")) {
      return { browser: "firefox" };
    }
    for (const [prefix, exe] of Object.entries(windowsProgIdMap)) {
      if (progId.startsWith(prefix)) {
        return { browser: exe };
      }
    }
    return null;
  }

  // Extract the executable path from the command
  const cmdMatch = cmdResult.stdout.match(REG_COMMAND_REGEX);
  if (cmdMatch) {
    return { browser: cmdMatch[1], path: cmdMatch[1] };
  }

  // Fallback to browser name
  if (progId.startsWith("FirefoxURL")) {
    return { browser: "firefox" };
  }
  for (const [prefix, exe] of Object.entries(windowsProgIdMap)) {
    if (progId.startsWith(prefix)) {
      return { browser: exe };
    }
  }
  return null;
}

/**
 * Detects the default browser on Linux by querying `xdg-settings get default-web-browser`.
 *
 * @param execFn - Command executor function.
 * @returns The browser command name, or `null` if undetermined.
 */
async function detectLinuxBrowser(
  execFn: ExecFn
): Promise<{ browser: string } | null> {
  try {
    const result = await execFn(
      ["xdg-settings", "get", "default-web-browser"],
      "."
    );
    if (result.exitCode !== 0) {
      return null;
    }

    const name = result.stdout.trim().replace(DESKTOP_SUFFIX_REGEX, "");
    return linuxDesktopMap[name] ? { browser: linuxDesktopMap[name] } : null;
  } catch {
    return null;
  }
}

/**
 * Detects the default browser for the current operating system.
 *
 * Uses platform-specific detection: reads `LSHandlerURLScheme` defaults on
 * macOS, queries the Windows registry for HTTP handler prog IDs on Windows,
 * and checks `xdg-settings` on Linux.
 *
 * @param platform - The OS platform (defaults to `process.platform`).
 * @param execFn - Optional command executor for testing.
 * @returns The detected browser command name, or `null` if detection fails.
 */
export function detectBrowser(
  platform: string = process.platform,
  execFn: ExecFn = typeof Bun === "undefined" ? execNodejs : execBun
): Promise<{ browser: string; path?: string } | null> {
  if (platform === "darwin") {
    return detectMacosBrowser(execFn).catch(() => null);
  }

  if (platform === "win32") {
    return detectWindowsBrowser(execFn).catch(() => null);
  }
  return detectLinuxBrowser(execFn).catch(() => null);
}

/**
 * Escapes a string for safe interpolation into an AppleScript command.
 *
 * @param s - The string to escape.
 * @returns The escaped string.
 */
function escapeForAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Builds platform-specific command arrays for opening URLs in a browser.
 *
 * @param urls - The URLs to open.
 * @param platform - The OS platform string.
 * @param browserInfo - The detected browser name and optional path.
 * @returns Array of command arrays to execute.
 */
function buildOpenCommands(
  urls: string[],
  platform: string,
  browserInfo: { browser: string; path?: string } | null
): string[][] {
  if (platform === "darwin") {
    if (browserInfo?.browser) {
      // If the browser is a direct executable path, invoke it directly
      if (
        browserInfo.browser.startsWith("/") &&
        !browserInfo.browser.endsWith(".app")
      ) {
        return [[browserInfo.browser, "--new-window", ...urls]];
      }
      return [
        ["open", "-na", browserInfo.browser, "--args", "--new-window", ...urls],
      ];
    }
    // No detected browser — use osascript to open all URLs together
    const script = urls
      .map((u) => `open location "${escapeForAppleScript(u)}"`)
      .join("\n");
    return [["osascript", "-e", script]];
  }

  if (platform === "win32") {
    const browserPath = browserInfo?.path;
    if (browserPath) {
      // Pass all URLs in a single command so they open in one window
      return [[browserPath, "--new-window", ...urls]];
    }
    // Fallback to cmd start for each URL
    return urls.map((url) => ["cmd", "/c", "start", "", url]);
  }

  if (browserInfo) {
    // Linux: pass all URLs in a single command
    return [[browserInfo.browser, "--new-window", ...urls]];
  }

  return urls.map((url) => ["xdg-open", url]);
}

/**
 * Opens one or more URLs in the system browser.
 *
 * Builds platform-appropriate open commands (macOS `open`, Windows `start`,
 * Linux `xdg-open`) and executes them sequentially.
 *
 * @param urls - Array of URLs to open.
 * @param platform - The OS platform (defaults to `process.platform`).
 * @param execFn - Optional command executor for testing.
 * @param browserOverride - Override the auto-detected browser.
 */
export async function openURLs(
  urls: string[],
  platform: string = process.platform,
  execFn?: ExecFn,
  browserOverride?: string
) {
  if (urls.length === 0) {
    return;
  }

  const browserInfo = browserOverride
    ? { browser: browserOverride, path: browserOverride }
    : await detectBrowser(platform, execFn);
  const commands = buildOpenCommands(urls, platform, browserInfo);

  for (const cmd of commands) {
    if (typeof Bun === "undefined") {
      openURLNodejs(cmd);
    } else {
      openURLBun(cmd);
    }
  }
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
    const shouldOpen = await handlePRDisplay(prUrls);
    if (shouldOpen) {
      if (browser) {
        log.info(`Using browser: ${browser}`);
      } else {
        log.info("Using browser: auto-detected");
      }
      await openURLs(prUrls, undefined, undefined, browser);
    }
  } else if (!args.dryRun) {
    log.info("No pull requests were created.");
  }

  outro("Done!");
}
