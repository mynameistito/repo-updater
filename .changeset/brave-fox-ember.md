---
"repo-updater": patch
---

Add ENOENT guard and actionable diagnostic when Node.js re-exec fails on Windows. Emit a clear stderr message suggesting `npm i -g repo-updater` or installing Node.js when `node` is not found on PATH. Handle null exit code from signal-killed processes. Add inline comment in `openURLs` explaining why all URL-open commands route through `openURLNodejs` unconditionally to prevent UAC prompts under Bun on Windows.
