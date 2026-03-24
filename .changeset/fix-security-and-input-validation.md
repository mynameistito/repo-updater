---
"repo-updater": patch
---

Fix CodeQL security alerts and add calendar-aware date validation

- Restrict CI workflow permissions to `contents: read` to address CodeQL permission alert
- Add `isValidCalendarDate` helper that rejects semantically invalid dates (e.g. `2024-02-30`) even when they match `YYYY-MM-DD` format
- Introduce `InvalidInputError` for structured input validation errors
- Guard `stderr` access in `processRepo` with an `"in"` check to safely handle the wider `CommandFailedError | InvalidInputError` union type
