# Logging

LogTape for all runtime logging. Categories: `["zotlit", "<workspace>", ...]`; see each package's `AGENTS.md` for the import path.

Libraries only `getLogger()` — never `configure()` (that's the app's job).

Prefer structured logging (named fields object) over interpolated template strings. For expensive context, pass a lazy callback.
