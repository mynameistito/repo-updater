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
import { loadConfig, validateRepos } from "./config.ts";
import { execBun, execNodejs, updateRepo } from "./runner.ts";

export function printUsage() {
  console.log(`
Usage: repo-updater [options] [repo paths...]

Options:
  -h, --help           Show this help message
  -n, --dry-run        Print steps without executing
  -m, --minor          Only update minor/patch versions (avoid breaking changes)
  -c, --config <path>  Path to config file
  --no-changeset       Skip changeset creation
  --no-workspaces      Skip workspace detection (update root only)

Examples:
  repo-updater                              # Update all repos from config
  repo-updater --dry-run                    # Preview without executing
  repo-updater --minor                      # Only minor/patch updates
  repo-updater -c ./my-config.json          # Use custom config
  repo-updater E:\\GitHub\\org\\repo1          # Update specific repos
`);
}

export function resolveRepos(args: ParsedArgs): string[] | null {
  if (args.positional.length > 0) {
    return args.positional;
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

  return configResult.value.repos;
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

export async function detectBrowser(
  platform: string = process.platform,
  execFn: ExecFn = typeof Bun === "undefined" ? execNodejs : execBun
): Promise<{ browser: string } | null> {
  if (platform === "darwin") {
    return null;
  }

  try {
    if (platform === "win32") {
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

export async function openURLs(
  urls: string[],
  platform: string = process.platform,
  execFn?: ExecFn
) {
  const browserInfo = await detectBrowser(platform, execFn);

  for (const url of urls) {
    let cmd: string[];

    if (platform === "darwin") {
      cmd = ["open", "-n", url];
    } else if (browserInfo) {
      cmd = [browserInfo.browser, "--new-window", url];
    } else if (platform === "win32") {
      cmd = ["cmd", "/c", "start", "", url];
    } else {
      cmd = ["xdg-open", url];
    }

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

  const repos = resolveRepos(args);
  if (!repos) {
    outro("Exiting.");
    process.exit(1);
  }

  const { valid, missing, notGit } = validateRepos(repos);

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
      await openURLs(prUrls);
    }
  } else if (!args.dryRun) {
    log.info("No pull requests were created.");
  }

  outro("Done!");
}
