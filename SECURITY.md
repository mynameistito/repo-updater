# Security Policy

## Supported Versions

Only the latest release receives security fixes.

| Version | Supported |
|---------|-----------|
| Latest  | yes       |
| Older   | no        |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Use GitHub's private vulnerability reporting:

1. Go to the [Security tab](../../security) of this repository.
2. Click **"Report a vulnerability"**.
3. Describe the issue, steps to reproduce, and potential impact.

We will acknowledge reports within **72 hours** and aim to release a patch within **14 days** for confirmed vulnerabilities.

## Scope

Security issues relevant to this project include:

- **Command injection** — user-supplied input (repo paths, package names, version ranges) being passed unsafely to shell commands or the `gh` CLI.
- **Path traversal** — crafted repository paths escaping the intended working directory.
- **Dependency confusion / supply chain** — a dependency being resolved to a malicious package with the same name.
- **Credential exposure** — GitHub tokens or other secrets being leaked through logs, error output, or process arguments.

Issues in third-party dependencies should be reported directly to the upstream maintainer. If the vulnerability is only exploitable through `repo-updater`, please report it here as well.

## Out of Scope

- Vulnerabilities that require physical access to the machine running the tool.
- Theoretical issues with no practical attack path.
- General best-practice suggestions not related to a specific vulnerability.

## Disclosure Policy

We follow a coordinated disclosure model. Please allow us the agreed remediation window before publishing details publicly. We will credit reporters in the release notes unless anonymity is requested.
