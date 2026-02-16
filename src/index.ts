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
          repos: ["C:\\path\\to\\repo-one", "C:\\path\\to\\repo-two"],
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
  prUrls: string[],
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
    log.success(`${repoName}: ${prUrl}`);
    if (prUrl) {
      prUrls.push(prUrl);
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
    await processRepo(repo, date, dryRun, prUrls, updateFn);
  }
}

async function handlePRDisplay(prUrls: string[]) {
  if (prUrls.length === 0) {
    return false;
  }

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

function openURLs(urls: string[]) {
  for (const url of urls) {
    const platform = process.platform;
    if (platform === "win32") {
      Bun.spawn(["cmd", "/c", "start", "", url], { stdout: "ignore" });
    } else if (platform === "darwin") {
      Bun.spawn(["open", url], { stdout: "ignore" });
    } else {
      Bun.spawn(["xdg-open", url], { stdout: "ignore" });
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
