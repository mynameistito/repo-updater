import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, isAbsolute } from "node:path";
import { loadConfig } from "../src/config.ts";

const RUN_ENV = "REPO_UPDATER_OPEN_BROWSER_TEST";
const BROWSER_ENV = "REPO_UPDATER_BROWSER";
const URL_ENV = "REPO_UPDATER_OPEN_BROWSER_URL";
const DEFAULT_URL = "https://example.com/?repo-updater-browser-test=1";
const LAUNCH_TIMEOUT_MS = 5000;
const TRUTHY_ENV_VALUES = new Set(["1", "true", "yes"]);
const WINDOWS_ABSOLUTE_PATH_REGEX = /^[A-Z]:\\/i;
const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);

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

function getTestUrl(): string {
  const rawUrl = process.env[URL_ENV] ?? DEFAULT_URL;
  const url = new URL(rawUrl);

  if (!ALLOWED_URL_PROTOCOLS.has(url.protocol)) {
    throw new Error(
      `${URL_ENV} must use an http: or https: URL, received: ${rawUrl}`
    );
  }

  return url.href;
}

function isFilesystemPath(value: string): boolean {
  return (
    WINDOWS_ABSOLUTE_PATH_REGEX.test(value) ||
    value.includes("/") ||
    value.includes("\\")
  );
}

function validateBrowserExecutable(browser: string): string {
  if (!browser) {
    throw new Error(`${BROWSER_ENV} or config browser must not be empty.`);
  }

  if (!(isFilesystemPath(browser) && isAbsolute(browser))) {
    throw new Error(
      `${BROWSER_ENV} or config browser must be an absolute executable path for this local smoke test.`
    );
  }

  if (!existsSync(browser)) {
    throw new Error(`Configured browser executable does not exist: ${browser}`);
  }

  if (
    process.platform === "win32" &&
    extname(browser).toLowerCase() !== ".exe"
  ) {
    throw new Error(
      `Configured Windows browser must be a .exe file: ${browser}`
    );
  }

  return browser;
}

async function openBrowserForLocalTest(browser: string, url: string) {
  const browserExecutable = validateBrowserExecutable(browser);
  const browserArgs = ["--new-window", url];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(browserExecutable, browserArgs, {
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
      child.unref();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const timeout = setTimeout(() => {
      settle(
        new Error(
          `Timed out launching browser command: ${browserExecutable} ${browserArgs.join(" ")}`
        )
      );
    }, LAUNCH_TIMEOUT_MS);

    child.once("error", (error) => {
      settle(error);
    });

    child.once("spawn", () => {
      setTimeout(settle, 500);
    });

    child.once("close", (code) => {
      if (code && !settled) {
        settle(
          new Error(
            `Browser launch command exited early with code ${code}: ${browserExecutable} ${browserArgs.join(" ")}`
          )
        );
      }
    });
  });
}

describe("local browser opening", () => {
  test.skipIf(!shouldRun)(
    `opens a real browser window when ${RUN_ENV}=1`,
    async () => {
      const browser = getBrowserOverride();
      const url = getTestUrl();

      await openBrowserForLocalTest(browser, url);

      expect(browser.length).toBeGreaterThan(0);
    }
  );
});
