---
status: accepted
---

# Desktop Slots are a pool of N vaults

Supersedes the "one slot" part of ADR 0077. The rest of 0077 still stands: the Desktop Queue, the Memory Gate, Leases and the Admission Deadline.

ADR 0077 kept a single Desktop Slot. Its reason was that two End-to-end Runs in one Obsidian app would steal each other's focus, throttling and reloads. The code says otherwise:

- focus is emulated per window through CDP;
- background throttling is set per window;
- `reload` is sent to one vault with `vault=`;
- all input is synthetic;
- vault windows open behind other apps (#1663).

Vaults, Fixtures, ports and Paired Zotero profiles were already separate per worktree. Only three things are left that runs share inside the one app:

- **the vault registry**, which every run writes;
- **the window-created hook** that `obsidian-vault open --inactive` installs;
- **the OS clipboard**, which two e2e files write and read.

So admission keeps its shape and the slot becomes a pool:

```text
Desktop Queue (FIFO, no overtaking)
  the head claims when
    a slot of N is free (default 2, ZOTLIT_DESKTOP_SLOTS)
    and no holder from its own worktree has a slot
    or, for an Exclusive Hold, all N slots are free
  → Memory Gate → Lease → run in the worktree's own vault window
```

- **Exclusive Hold:** `measure:query` takes all N slots, because its timings mean nothing while another run competes for CPU. So does `desktop-slot run --exclusive`, for a manual walk that needs the whole app, such as a screen capture. Everything else takes one slot.
- **The vault registry and the window-created hook:** `obsidian-vault open|remove` runs under a short machine-wide mutex.
- **The clipboard:** each run replaces `electron.clipboard` and `navigator.clipboard` with an in-memory clipboard in its own vault windows. The plugin's copy paths run there, so they are still exercised.

## Considered options

- **One Obsidian app per run** (`--user-data-dir`): this isolates all app state, but every run would need its own launch, its own login and its own memory. It would also stop attaching to the developer's running app. The app state that remains shared is small enough to close directly.
- **A clipboard lock, or an Exclusive Hold for runs that touch the clipboard:** `paired-run` touches the clipboard and is in every full run, so this would either add a third lock or serialize everything again.
- **Concurrent runs within one worktree:** they would share the vault path, the `dist-dev` build and the Paired Zotero layout. Holders from the same worktree wait for each other, as they did before.
- **Backfilling past a waiting Exclusive Hold:** the Exclusive Hold could starve. Strict FIFO keeps every wait bounded.

## Consequences

- Runs in different worktrees overlap, up to N at a time. Files within one run stay serial, because they share the run's vault.
- N is a guard on contention (CPU, timeouts). Memory stays the Memory Gate's job.
- A waiting Exclusive Hold makes later single-slot waiters wait behind it.
- A test must not use the OS clipboard, and it must not open or remove a vault outside `obsidian-vault`.
