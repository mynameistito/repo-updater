import * as BunTest from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { loadConfig } from "../src/config.ts";

const RUN_ENV = "REPO_UPDATER_OPEN_BROWSER_TEST";
const BROWSER_ENV = "REPO_UPDATER_BROWSER";
const URL_ENV = "REPO_UPDATER_OPEN_BROWSER_URL";
const DEFAULT_URL = "https://example.com/?repo-updater-browser-BunTest.test=1";
const LAUNCH_TIMEOUT_MS = 5000;
const TRUTHY_ENV_VALUES = new Set(["1", "true", "yes"]);
const WINDOWS_ABSOLUTE_PATH_REGEX = /^[A-Z]:\\/iu;
const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);

const shouldRun = TRUTHY_ENV_VALUES.has(
  (process.env[RUN_ENV] ?? "").toLowerCase()
);

const getBrowserOverride = (): string => {
  const envBrowser = process.env[BROWSER_ENV];
  if (envBrowser) {
    return envBrowser;
  }

  const config = loadConfig();
  if (config.isErr()) {
    throw new Error(
      `Set ${BROWSER_ENV} or create a repo-updater config with a browser field before running this local BunTest.test. ${config.error.message}`
    );
  }

  if (!config.value.browser) {
    throw new Error(
      `Set ${BROWSER_ENV} or add a browser field to your repo-updater config before running this local BunTest.test.`
    );
  }

  return config.value.browser;
};

const getTestUrl = (): string => {
  const rawUrl = process.env[URL_ENV] ?? DEFAULT_URL;
  const url = new URL(rawUrl);

  if (!ALLOWED_URL_PROTOCOLS.has(url.protocol)) {
    throw new Error(
      `${URL_ENV} must use an http: or https: URL, received: ${rawUrl}`
    );
  }

  return url.href;
};

const isFilesystemPath = (value: string): boolean =>
  WINDOWS_ABSOLUTE_PATH_REGEX.test(value) ||
  value.includes("/") ||
  value.includes("\\");

const validateBrowserExecutable = (browser: string): string => {
  if (!browser) {
    throw new Error(`${BROWSER_ENV} or config browser must not be empty.`);
  }

  if (!(isFilesystemPath(browser) && path.isAbsolute(browser))) {
    throw new Error(
      `${BROWSER_ENV} or config browser must be an absolute executable path for this local smoke BunTest.test.`
    );
  }

  if (!existsSync(browser)) {
    throw new Error(`Configured browser executable does not exist: ${browser}`);
  }

  if (
    process.platform === "win32" &&
    path.extname(browser).toLowerCase() !== ".exe"
  ) {
    throw new Error(
      `Configured Windows browser must be a .exe file: ${browser}`
    );
  }

  return browser;
};

const openBrowserForLocalTest = async (browser: string, url: string) => {
  const browserExecutable = validateBrowserExecutable(browser);
  const browserArgs = ["--new-window", url];

  const child = spawn(browserExecutable, browserArgs, {
    stdio: "ignore",
    windowsHide: true,
  });
  const abortController = new AbortController();
  const signal = AbortSignal.any([
    abortController.signal,
    AbortSignal.timeout(LAUNCH_TIMEOUT_MS),
  ]);

  try {
    await Promise.race([
      once(child, "error", { signal }).then(([error]) => {
        throw error;
      }),
      once(child, "spawn", { signal }),
      once(child, "close", { signal }).then(async ([code]) => {
        if (code) {
          throw new Error(
            `Browser launch command exited early with code ${code}: ${browserExecutable} ${browserArgs.join(" ")}`
          );
        }
        await once(child, "spawn", { signal });
      }),
    ]);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        `Timed out launching browser command: ${browserExecutable} ${browserArgs.join(" ")}`,
        { cause: error }
      );
    }
    throw error;
  } finally {
    abortController.abort();
  }

  await delay(500);
  child.unref();
};

BunTest.describe("local browser opening", () => {
  BunTest.test.skipIf(!shouldRun)(
    `opens a real browser window when ${RUN_ENV}=1`,
    async () => {
      const browser = getBrowserOverride();
      const url = getTestUrl();

      await openBrowserForLocalTest(browser, url);

      BunTest.expect(browser.length).toBeGreaterThan(0);
    }
  );
});
