# Citation CLI exposes index facts, not view presentation

The agent-facing citation commands (`zotlit:cited-by`, `zotlit:references`) return
what the Citation Index knows — citing-note groups, Citation Occurrences with
positions, coverage and resolution states, and per-entry Item identity — and omit
what the Cited By Sidebar and References Sidebar layer on top: Citation Context
excerpts and engine-rendered bibliography entries. An agent holds vault file
access, so a path plus a position replaces an excerpt at whatever radius the
agent wants; the rendered form is presentation (a DOM fragment from the Pandoc
Engine), not data an agent reasons over; and full item detail already ships
through `zotlit:template-data`, so carrying CSL or Attachment data here would
create a second surface for the same facts.

## Consequences

- The References Sidebar's six entry kinds collapse to four in CLI output —
  `resolved`, `unresolved`, `missing`, `malformed` — because the
  rendered/summary/unrendered distinction only reports Pandoc Engine state.
- `degraded` coverage or resolution is settled data in the payload, not a
  failure; only the transitional `indexing`/`resolving` states gate the
  settle-wait.
- An agent that wants excerpt text or a formatted bibliography composes it from
  the positions and `zotlit:template-data` / the Pandoc export workflow instead
  of asking these commands for it.
