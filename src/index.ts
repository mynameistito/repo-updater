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
import { updateRepo } from "./runner.ts";

export function printUsage() {
  console.log(`
Usage: repo-updater [options] [repo paths...]

Options:
  -h, --help           Show this help message
  -n, --dry-run        Print steps without executing
  -c, --config <path>  Path to config file

Examples:
  repo-updater                              # Update all repos from config
  repo-updater --dry-run                    # Preview without executing
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
  updateFn: typeof updateRepo = updateRepo
): Promise<{ repo: string; status: string; prUrl?: string }> {
  const repoName = basename(repo);
  log.step(repoName);

  if (dryRun) {
    const result = await updateFn({ repo, date, dryRun: true });
    console.log();
    return result.isOk() ? result.value : { repo, status: "failed" };
  }

  const s = spinner();
  s.start("Updating dependencies...");

  const result = await updateFn({ repo, date, dryRun: false });

  if (result.isErr()) {
    s.stop(`Failed: ${repoName}`);
    log.error(`${repoName}: ${result.error.message}`);
    if (result.error.stderr) {
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

async function handleRepoProcessing(
  valid: string[],
  date: string,
  dryRun: boolean,
  prUrls: string[],
  updateFn: typeof updateRepo
) {
  for (const repo of valid) {
    const result = await processRepo(repo, date, dryRun, updateFn);
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

export function openURLNodejs(cmd: string[]): void {
  // Node.js fallback
  const { spawn } = require("node:child_process");
  spawn(cmd[0], cmd.slice(1), { stdio: "ignore" });
}

export function openURLs(urls: string[], platform: string = process.platform) {
  for (const url of urls) {
    const cmd = 
      platform === "win32" 
        ? ["cmd", "/c", "start", "", url]
        : platform === "darwin"
          ? ["open", url]
          : ["xdg-open", url];

    if (typeof Bun !== "undefined") {
      openURLBun(cmd);
    } else {
      openURLNodejs(cmd);
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

  const { valid, missing } = validateRepos(repos);

  for (const m of missing) {
    log.warn(`Directory not found: ${m}`);
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

  await handleRepoProcessing(valid, date, args.dryRun, prUrls, updateFn);

  if (prUrls.length > 0) {
    const shouldOpen = await handlePRDisplay(prUrls);
    if (shouldOpen) {
      openURLs(prUrls);
    }
  } else if (!args.dryRun) {
    log.info("No pull requests were created.");
  }

  outro("Done!");
}
