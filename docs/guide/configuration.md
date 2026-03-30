# Configuration

repo-updater reads from a JSON config file to know which repos to update and which browser to use for opening PRs. You can also pass everything on the command line.

## Config file format

The config file is a JSON object with a `repos` array and an optional `browser` field. A minimal example:

```json
{
  "repos": [
    "C:\\Users\\you\\projects\\app-one",
    "/home/you/repos/library-two"
  ]
}
```

Adding a browser preference:

```json
{
  "repos": [
    "/home/you/repos/my-project"
  ],
  "browser": "firefox"
}
```

`repos` is the only required field. It holds an array of absolute filesystem paths pointing at git repositories. Both Windows backslash paths and Unix forward-slash paths work.

`browser` is optional. When set, repo-updater uses that browser to open PR URLs instead of auto-detecting the system default.

## Resolution order

The tool looks for a config file in three places. It stops at the first match.

1. The path you pass with `-c` or `--config`
2. `./repo-updater.config.json` in your current working directory
3. `~/.config/repo-updater/config.json` in your home directory

If none of these exist and you did not pass any repo paths as positional arguments, the tool exits with an error. You need either a config file with a `repos` array or at least one positional path.

## The repos array

Each entry must be an absolute path to a directory on disk. The tool checks two things for every path you give it:

- The directory exists
- The directory contains a `.git` subdirectory

Paths that fail either check are skipped, and the tool logs a warning for each one. It does not abort, it just processes the valid repos and tells you which ones it ignored.

See `config.json.example` in the repo root for a starting point.

## The browser field

This is a string value like `"firefox"`, `"chrome"`, or `"brave"`. It tells the tool which command to run when opening PR URLs after it finishes updating a repo.

You rarely need to set this manually. The tool auto-detects the default browser on macOS, Windows, and Linux. The override exists for when auto-detection picks the wrong one, or when you want to open PRs in a browser other than your default.

You can set it in the config file, or pass it once with the `-b` flag, which writes it to the config file for you so it sticks around.

## CLI flags

These are the flags the tool accepts. Check the main README for fuller descriptions.

| Flag | Description |
|------|-------------|
| `-h`, `--help` | Print usage information |
| `-n`, `--dry-run` | Print what the tool would do, without making changes |
| `-m`, `--minor` | Use conservative `npm update` instead of upgrading to latest versions |
| `-c`, `--config <path>` | Point to a specific config file |
| `-b`, `--browser <name>` | Set and persist the browser preference |
| `--no-changeset` | Skip generating changeset files after updating |
| `--no-workspaces` | Skip workspace detection and treat each repo as a single package |

## CLI flags vs config

CLI flags always win over config file values. If you pass positional repo paths on the command line, those take precedence over the `repos` array in your config file. The config file acts as a default that the command line can override.

The tool merges the two sources: it loads the config, applies the CLI flags on top, and uses whichever is more specific. A `-c` flag tells the tool to ignore the usual search locations and use the file you pointed at instead.
