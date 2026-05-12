---
"repo-updater": minor
---

Internal code quality cleanup.

- Remove unused `openURLBunSync` export and dedupe the Windows browser detection fallback into a shared `fallbackBrowserFromProgId` helper.
- Drop narrating comments that restated the adjacent code; keep load-bearing notes (Windows UAC / hard-reset rationale).
- `performCleanup` now runs every step best-effort and returns `Result<void, CleanupError>` aggregating per-step failures, so a partially-cleaned repo surfaces a single actionable message instead of scattered `console.warn` lines.
- Split browser detection / URL opening into `src/browser.ts` (`index.ts` shrinks 765 → 356 lines). Public API is preserved via re-export from `index.ts`.
