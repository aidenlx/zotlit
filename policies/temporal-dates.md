# Temporal dates

Use the `Temporal` API (`Temporal.Now`, `Temporal.PlainTime`, etc.) for dates and times.

- Never reach for `Date`, `date-fns`, or `dayjs` — not even for a tiny one-off formatter.
- Exception: `apps/zotero` runs on Zotero's Firefox 140 ESR, which ships no `Temporal`. See [`apps/zotero/policies/dates.md`](../apps/zotero/policies/dates.md).
