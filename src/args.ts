export interface ParsedArgs {
  help: boolean;
  dryRun: boolean;
  configPath: string | undefined;
  positional: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  let help = false;
  let dryRun = false;
  let configPath: string | undefined;
  const positional: string[] = [];

  const iter = argv[Symbol.iterator]();
  for (const arg of iter) {
    if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "-n" || arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "-c" || arg === "--config") {
      configPath = iter.next().value as string | undefined;
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  return { help, dryRun, configPath, positional };
}

export function getDate(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}
