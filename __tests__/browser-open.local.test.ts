import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { loadConfig } from "../src/config.ts";

const RUN_ENV = "REPO_UPDATER_OPEN_BROWSER_TEST";
const BROWSER_ENV = "REPO_UPDATER_BROWSER";
const URL_ENV = "REPO_UPDATER_OPEN_BROWSER_URL";
const DEFAULT_URL = "https://example.com/?repo-updater-browser-test=1";
const LAUNCH_TIMEOUT_MS = 5000;
const TRUTHY_ENV_VALUES = new Set(["1", "true", "yes"]);
const WINDOWS_ABSOLUTE_PATH_REGEX = /^[A-Z]:\\/i;

const shouldRun = TRUTHY_ENV_VALUES.has(
  (process.env[RUN_ENV] ?? "").toLowerCase()
);

function getBrowserOverride(): string {
  const envBrowser = process.env[BROWSER_ENV];
  if (envBrowser) {
    return envBrowser;
  }

  const config = loadConfig();
  if (config.isErr()) {
    throw new Error(
      `Set ${BROWSER_ENV} or create a repo-updater config with a browser field before running this local test. ${config.error.message}`
    );
  }

  if (!config.value.browser) {
    throw new Error(
      `Set ${BROWSER_ENV} or add a browser field to your repo-updater config before running this local test.`
    );
  }

  return config.value.browser;
}

function isFilesystemPath(value: string): boolean {
  return (
    WINDOWS_ABSOLUTE_PATH_REGEX.test(value) ||
    value.includes("/") ||
    value.includes("\\")
  );
}

function buildLocalOpenCommand(
  browser: string,
  url: string
): { args: string[]; cmd: string; waitForExit: boolean } {
  if (process.platform === "win32") {
    return {
      cmd: "cmd",
      args: ["/c", "start", "", browser, "--new-window", url],
      waitForExit: true,
    };
  }

  if (process.platform === "darwin" && !isFilesystemPath(browser)) {
    return {
      cmd: "open",
      args: ["-na", browser, "--args", "--new-window", url],
      waitForExit: true,
    };
  }

  return { cmd: browser, args: ["--new-window", url], waitForExit: false };
}

async function openBrowserForLocalTest(browser: string, url: string) {
  const command = buildLocalOpenCommand(browser, url);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.cmd, command.args, {
      stdio: "ignore",
      windowsHide: true,
    });
    let settled = false;

    const settle = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (!command.waitForExit) {
        child.unref();
      }
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const timeout = setTimeout(() => {
      settle(
        new Error(
          `Timed out launching browser command: ${command.cmd} ${command.args.join(" ")}`
        )
      );
    }, LAUNCH_TIMEOUT_MS);

    child.once("error", (error) => {
      settle(error);
    });

    if (command.waitForExit) {
      child.once("close", (code) => {
        if (code === 0) {
          settle();
        } else {
          settle(
            new Error(
              `Browser launch command failed with exit code ${code}: ${command.cmd} ${command.args.join(" ")}`
            )
          );
        }
      });
    } else {
      child.once("spawn", () => {
        setTimeout(settle, 500);
      });
    }
  });
}

describe("local browser opening", () => {
  test.skipIf(!shouldRun)(
    `opens a real browser window when ${RUN_ENV}=1`,
    async () => {
      const browser = getBrowserOverride();
      const url = process.env[URL_ENV] ?? DEFAULT_URL;

      if (isFilesystemPath(browser) && !existsSync(browser)) {
        throw new Error(
          `Configured browser executable does not exist: ${browser}`
        );
      }

      await openBrowserForLocalTest(browser, url);

      expect(browser.length).toBeGreaterThan(0);
    }
  );
});
