# Fixture

The generated, disposable test environment for ZotLit — Zotero data, a Zotero
profile, and an Obsidian vault built from one committed spec — and the
vocabulary around building and consuming it.

## Language

**The Fixture**:
The one generated test environment: a Zotero data directory, a Zotero profile,
and an Obsidian vault, all derived from the Fixture Spec and disposable.
_Avoid_: acceptance fixture, standard fixture, test fixture

**Fixture Spec**:
The committed, reviewable description of the Fixture's semantic content — the
single source of truth every build reproduces.
_Avoid_: fixture data, seed data

**Fixture Vault**:
The generated Obsidian vault whose Literature Notes reference only items that
exist in the Fixture's Zotero data.
_Avoid_: zt-vault, test vault

**Scope Case**:
A named, saved Library Scope state (all, available, partial, unavailable).

**End-to-end Run**:
The plugin running in a real Obsidian window, reading the Fixture's Zotero
data directory from disk.
_Avoid_: acceptance run (for the automated flavor), e2e test (for the manual flavor)

**Paired Zotero**:
A real Zotero 10 instance — the live counterpart of the Fixture Vault during
development.
_Avoid_: test Zotero, dev Zotero, fixture instance

**Stress Build**:
An on-demand Fixture build scaled to a large synthetic item count for
performance testing.
_Avoid_: perf fixture, large fixture
