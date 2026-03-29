import { existsSync } from "node:fs";
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

export function resolveRepos(
  args: ParsedArgs
): { repos: string[]; config?: Config } | null {
  if (args.positional.length > 0) {
    return { repos: args.positional };
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

export function openURLBun(cmd: string[]): void {
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
}

export function openURLBunSync(cmd: string[]): number | null {
  try {
    const proc = Bun.spawnSync(cmd, { stdout: "ignore", stderr: "ignore" });
    return proc.exitCode;
  } catch (err) {
    console.error(`openURLBunSync failed for ${cmd.join(" ")}:`, err);
    return null;
  }
}

export async function openURLNodejs(cmd: string[]): Promise<void> {
  const { spawn } = await import("node:child_process");
  spawn(cmd[0], cmd.slice(1), { stdio: "ignore" });
}

export type ExecFn = (
  cmd: string[],
  cwd: string
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

const PROG_ID_REGEX = /ProgId\s+REG_SZ\s+(\S+)/;
const DESKTOP_SUFFIX_REGEX = /\.desktop$/;
const MACOS_FIREFOX_REGEX =
  /LSHandlerURLScheme\s*=\s*https[\s\S]*?LSHandlerRoleAll\s*=\s*"?(org\.mozilla\.firefox)"?/;
const REG_COMMAND_REGEX = /\(Default\)\s+REG_SZ\s+"?([^"]+\.exe)"?/i;

const windowsProgIdMap: Record<string, string> = {
  ChromeHTML: "chrome",
  MSEdgeHTM: "msedge",
  BraveHTML: "brave",
};

const linuxDesktopMap: Record<string, string> = {
  "google-chrome": "google-chrome",
  "google-chrome-stable": "google-chrome-stable",
  firefox: "firefox",
  chromium: "chromium",
  "chromium-browser": "chromium-browser",
  "brave-browser": "brave-browser",
  "microsoft-edge": "microsoft-edge",
};

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
  if (result.exitCode === 0 && result.stdout.trim()) {
    const path = result.stdout.trim();
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

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

function buildOpenCommands(
  urls: string[],
  platform: string,
  browserInfo: { browser: string; path?: string } | null
): string[][] {
  if (platform === "darwin") {
    if (browserInfo?.browser) {
      return [
        ["open", "-na", browserInfo.browser, "--args", "--new-window", ...urls],
      ];
    }
    // No detected browser — use osascript to open all URLs together
    const script = urls.map((u) => `open location "${u}"`).join("\n");
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
      await openURLs(prUrls, undefined, undefined, browser);
    }
  } else if (!args.dryRun) {
    log.info("No pull requests were created.");
  }

  outro("Done!");
}
