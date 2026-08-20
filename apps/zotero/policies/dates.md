# Dates

Zotero's Firefox 140 ESR ships no `Temporal`, so this package is the one exception to [`policies/temporal-dates.md`](../../../policies/temporal-dates.md).

- Use native `Date` for instants, and `Intl.RelativeTimeFormat` / `Intl.DateTimeFormat` for display.
- No date library. `date-fns` and `dayjs` each carry their own locale registry, and every user-facing string in this package is localized through Fluent.
