# Dates

Zotero's Firefox 140 ESR ships no `Temporal`, so this package is the one exception to [`policies/temporal-dates.md`](../../../policies/temporal-dates.md).

- Use native `Date` for instants, and `Intl.RelativeTimeFormat` / `Intl.DateTimeFormat` for display.
- Localize user-facing date text through Fluent.
