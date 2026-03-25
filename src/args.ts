export interface ParsedArgs {
  configPath: string | undefined;
  dryRun: boolean;
  help: boolean;
  minor: boolean;
  noChangeset: boolean;
  noWorkspaces: boolean;
  positional: string[];
}

type BooleanFlag = "help" | "dryRun" | "minor" | "noChangeset" | "noWorkspaces";

const BOOLEAN_FLAGS: Record<string, BooleanFlag> = {
  "-h": "help",
  "--help": "help",
  "-n": "dryRun",
  "--dry-run": "dryRun",
  "-m": "minor",
  "--minor": "minor",
  "--no-changeset": "noChangeset",
  "--no-workspaces": "noWorkspaces",
};

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<BooleanFlag, boolean> = {
    help: false,
    dryRun: false,
    minor: false,
    noChangeset: false,
    noWorkspaces: false,
  };
  let configPath: string | undefined;
  const positional: string[] = [];

  const iter = argv[Symbol.iterator]();
  for (const arg of iter) {
    const boolFlag = BOOLEAN_FLAGS[arg];
    if (boolFlag) {
      flags[boolFlag] = true;
    } else if (arg === "-c" || arg === "--config") {
      const next = iter.next();
      if (next.done) {
        console.error(`${arg} requires a value`);
      } else {
        configPath = next.value as string;
      }
    } else if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  return { ...flags, configPath, positional };
}

export function getDate(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
}
