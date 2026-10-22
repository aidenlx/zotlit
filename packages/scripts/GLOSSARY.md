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

**Development Vault**:
The per-worktree Obsidian vault seeded from the Fixture Vault for manual
development and Paired Runs.
_Avoid_: dev vault, test vault

**Host Vault**:
An open Obsidian vault that provides the application access needed to prepare
a Development Vault.

**Scope Case**:
A named, saved Library Scope state (all, available, partial, unavailable).

**Vault Case**:
A named, saved Fixture Vault state beside the Library Scope — settings file,
notes, Profiles, and template files (configured, fresh, upgrader).
_Avoid_: vault preset, vault scenario

**End-to-end Run**:
The plugin running in a real Obsidian window, reading the Fixture's Zotero
data directory from disk.
_Avoid_: acceptance run (for the automated flavor), e2e test (for the manual flavor)

**Paired Zotero**:
A real Zotero 10 instance — the live counterpart of the Fixture Vault during
development.
_Avoid_: test Zotero, dev Zotero, fixture instance

**Paired Run**:
A session with Paired Zotero and a vault open together on the same Fixture: a
Development Vault for manual work, or a vault the End-to-end Run opens and
disposes.
_Avoid_: smoke run, manual End-to-end Run

**Stress Build**:
An on-demand Fixture build scaled to a large synthetic item count for
performance testing.
_Avoid_: perf fixture, large fixture

## Desktop admission

**Desktop Slot**:
One of a few places to drive the developer's one desktop Obsidian app, shared
across every clone, worktree, and session of the user on this machine. Each
holder drives its own vault, and a worktree holds at most one slot at a time. A
Paired Zotero joins a hold only when the hold opens a vault in that app;
Zotero-only work takes no slot.
_Avoid_: desktop lock, desktop mutex

**Exclusive Hold**:
A hold of every Desktop Slot at once, for work that needs the whole app to
itself, such as timing a query or capturing the screen.
_Avoid_: global lock, full lock

**Desktop Queue**:
The ordered line of waiters for a Desktop Slot; the waiter at its head is the
only one that may take a slot when one frees.
_Avoid_: lock waiters, wait list

**Lease**:
The bounded time a holder may keep its Desktop Slot, counted from when it was
admitted; a holder whose Lease ends loses the slot.
_Avoid_: timeout, hold limit

**Admission Deadline**:
How long a waiter will wait, at the Desktop Queue and the Memory Gate combined,
before giving up and reporting who is ahead of it.
_Avoid_: lock timeout, wait timeout

**Memory Gate**:
The machine-wide check that admits a heavy run (a test invocation or an
End-to-end Run) only while the OS reports that memory can grow and no other
gated run has just started. It admits a run; it does not hold anything for it.
_Avoid_: memory lock, memory slot
