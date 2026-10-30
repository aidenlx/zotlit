# Coding standards

Review-only policy index for apps/zotero. Load these during standards review. Apply the root standards too; local exceptions have the scope stated below. Keep implementation context in `AGENTS.md`.

Record each meaningful agent mistake in the relevant policy on its first occurrence, through `/retro`
or a direct edit. State the expected behavior and what the reviewer must check.

## Policies

- [Chrome injection](policies/chrome-injection.md)
- [Dates](policies/dates.md)
- [HTTP](policies/http.md)
- [Localization](policies/localization.md)
- [Preferences](policies/prefs.md)
- [Patching reader internals](policies/reader-patching.md)
- [Zotero 9 / 10 API shapes](policies/zotero-api-shapes.md)

## Logging

Import `getLogger` directly from `@logtape/logtape` with a category rooted at `["zotlit", "zotero", ...]`. Never call `console.*` or `Zotero.debug` directly from feature code.

```ts
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["zotlit", "zotero", "reader"]);
```

This package is the app, so it owns `configure()` — `setupLogging()` in `src/lib/logger.ts` is the only call site. Never call it from feature code.
