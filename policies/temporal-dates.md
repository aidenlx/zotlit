# Temporal dates

Use the `Temporal` API (`Temporal.Now`, `Temporal.PlainTime`, etc.) for dates and times.

- Never reach for `Date`, `date-fns`, or `dayjs` — not even for a tiny one-off formatter.
- Exception: `apps/zotero` runs on Zotero's Firefox 140 ESR, which ships no `Temporal`. See [`apps/zotero/policies/dates.md`](../apps/zotero/policies/dates.md).
- Exception: `apps/docs` runs on Cloudflare's workerd, which ships no `Temporal`. The exception is scoped to the publication-date schema and the reader-facing date helpers named in [`apps/docs/AGENTS.md`](../apps/docs/AGENTS.md) → Content pipeline → Dates.
