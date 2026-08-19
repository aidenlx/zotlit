# The Fixture database copies a committed pristine template

> **Status: proposed.** This ADR records the decision ahead of the work that
> implements it: the committed template, its regeneration command, the
> managed Zotero download, and `pnpm fixture zotero` described below land in
> the follow-up work that builds toward this design.

The Fixture pairs with a real Zotero 10 instance (the Paired Zotero), so its
`zotero.sqlite` must be a full-fidelity database that survives Zotero's
startup integrity check and writes. Every Fixture build copies a committed
pristine `zotero.sqlite` — created once by first-running an official,
version-pinned Zotero 10 build on an empty data directory — and inserts the
Fixture Spec's rows into the copy. The same managed Zotero install (downloaded
into a per-user cache keyed by version, Playwright-style: macOS DMG, Windows
portable zip) is what `pnpm fixture zotero` launches, so one pinned artifact
serves both the template harvest and the Paired Zotero.

## Considered Options

- **Minimal hand-written DDL** (the previous approach): sufficient for
  ZotLit's read-only queries, ruined the moment a real Zotero opens the
  database.
- **Vendor Zotero's schema sources** (`system.sql`/`userdata.sql`/
  `triggers.sql` + global schema JSON) and reimplement first-run
  initialization: reimplements logic the authoritative code already runs, and
  drifts silently.
- **Build-time dependency on a Zotero source checkout**: couples every
  Fixture build on every machine to an external checkout and its
  submodule/LFS/npm bootstrap.

## Consequences

- The committed template is a small binary; regeneration is a documented
  one-command step, needed only when Zotero bumps its schema.
- After a Paired Zotero session the database drifts from the Spec; rebuilding
  the Fixture is the reset. The Fixture is disposable by design, so this is
  accepted.
