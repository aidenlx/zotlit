# Dates

Zotero's Firefox 140 ESR ships no `Temporal`, so `src/` is the exception to the repository's date rule (`dateGlobals` in `packages/config/oxlint.base.ts`); `oxlint.config.ts` turns it off there. The Node scripts use `Temporal`.

- Use native `Date` for instants, and `Intl.RelativeTimeFormat` / `Intl.DateTimeFormat` for display.
- Localize user-facing date text through Fluent.
