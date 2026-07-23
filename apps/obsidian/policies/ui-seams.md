# UI seams

Functional core, imperative shell — logic modules return data and emit
events; a UI module at the seam owns rendering. Use `BaseNotice` from
`@/lib/notice` and `toast.promise` from `@/lib/toast`, never raw
`new Notice(...)`.

Reach for the lowest rung that fits:

1. Pure function returns the message/outcome; the caller renders it
   (`services/note-import/batch-import-notices.ts`).
2. Service emits an event; a UI subscriber owns the notice.
3. Narrow decision port, only when the UI's answer feeds back mid-flow —
   returns data, named for the decision (`services/note-import/view.ts`).

Tests observe the core: assert returns, events, and port calls. Needing to
`vi.mock` `@/lib/notice`/`@/lib/toast` — or to assert a notice fired — means
the module needs reshaping, not the test.
