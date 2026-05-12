/**
 * @module browser
 *
 * Cross-platform browser detection and URL opening. Reads OS defaults
 * (macOS `LSHandlers`, Windows registry, Linux `xdg-settings`) and routes
 * URLs through `node:child_process.spawn` with `windowsHide` so launches do
 * not raise a UAC prompt or flash a console window.
 */

import { execBun, execNodejs } from "./runner.ts";

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
/** Maximum time to wait for a browser process to report successful spawn. */
const OPEN_URL_SPAWN_TIMEOUT_MS = 5000;
/** Small grace period after spawn so Windows has time to hand off the URL. */
const OPEN_URL_SPAWN_GRACE_MS = 500;

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
 * Opens a URL using Bun's native `Bun.spawn` (fire-and-forget, the
 * returned subprocess is not awaited).
 *
 * @param cmd - The browser command and arguments.
 */
export function openURLBun(cmd: string[]): void {
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", windowsHide: true });
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

  await new Promise<void>((resolve, reject) => {
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
        new Error(`Timed out launching browser command: ${cmd.join(" ")}`)
      );
    }, OPEN_URL_SPAWN_TIMEOUT_MS);

    child.once("error", (error) => {
      settle(error);
    });

    child.once("spawn", () => {
      setTimeout(settle, OPEN_URL_SPAWN_GRACE_MS);
    });

    child.once("close", (code) => {
      if (code && !settled) {
        settle(
          new Error(
            `Browser launch command exited early with code ${code}: ${cmd.join(" ")}`
          )
        );
      }
    });
  });
}

async function detectMacosBrowser(
  execFn: ExecFn
): Promise<{ browser: string } | null> {
  // Firefox enforces single-instance locking, so callers need to know whether to use `open -n`.
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
  const path = result.stdout.trim();
  if (result.exitCode === 0 && path && EXE_SUFFIX_REGEX.test(path)) {
    return path;
  }
  return null;
}

async function detectWindowsBrowser(
  execFn: ExecFn
): Promise<{ browser: string; path?: string } | null> {
  const browserPath = await getWindowsDefaultBrowserPath(execFn);
  if (browserPath) {
    return { browser: browserPath, path: browserPath };
  }

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

  const cmdResult = await execFn(
    [
      "reg",
      "query",
      `HKLM\\SOFTWARE\\Classes\\${progId}\\shell\\open\\command`,
      "/ve",
    ],
    "."
  );
  if (cmdResult.exitCode === 0) {
    const cmdMatch = cmdResult.stdout.match(REG_COMMAND_REGEX);
    if (cmdMatch) {
      return { browser: cmdMatch[1], path: cmdMatch[1] };
    }
  }

  return fallbackBrowserFromProgId(progId);
}

function fallbackBrowserFromProgId(progId: string): { browser: string } | null {
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

/**
 * Detects the default browser for the current operating system.
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

function escapeForAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildOpenCommands(
  urls: string[],
  platform: string,
  browserInfo: { browser: string; path?: string } | null
): string[][] {
  if (platform === "darwin") {
    // Three strategies, in order:
    //   1. browserInfo.browser is an absolute non-.app path → exec the binary directly.
    //   2. .app bundle path or named app → `open -na <app> --args --new-window <urls>`.
    //   3. No browserInfo → AppleScript fallback via escapeForAppleScript.
    if (browserInfo?.browser) {
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
    const script = urls
      .map((u) => `open location "${escapeForAppleScript(u)}"`)
      .join("\n");
    return [["osascript", "-e", script]];
  }

  if (platform === "win32") {
    const browserPath = browserInfo?.path;
    if (browserPath) {
      return [[browserPath, "--new-window", ...urls]];
    }
    return urls.map((url) => ["cmd", "/c", "start", "", url]);
  }

  if (browserInfo) {
    return [[browserInfo.browser, "--new-window", ...urls]];
  }

  return urls.map((url) => ["xdg-open", url]);
}

/**
 * Opens one or more URLs in the system browser.
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

  // Always route through openURLNodejs. The `#!/usr/bin/env node` shebang
  // guarantees Node in published builds; in dev (`bun run start`) Bun's
  // node:child_process shim works too — windowsHide is the only differ and
  // dev users tolerate the console flash.
  for (const cmd of commands) {
    await openURLNodejs(cmd);
  }
}
