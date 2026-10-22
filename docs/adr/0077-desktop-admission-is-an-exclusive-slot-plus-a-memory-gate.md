---
status: superseded in part by ADR-0078
---

# Desktop admission is an exclusive slot plus a memory gate, with leases

Replaces the desktop lock, `zotlit-desktop.lock` in the git common dir. Exactly one process held it at a time, and a waiter polled for it with no deadline. On 2026-10-21 a manual `pnpm desktop-lock -- sleep 14400` held it for four hours. An agent's e2e baseline run waited until its 600 s tool timeout ran out and reported itself blocked, without knowing how long the hold would last.

Two resources are scarce, and they differ in kind. The developer's one desktop Obsidian app is exclusive, and nothing can measure how much of it is in use. Every End-to-end Run opens its vault in that app, through one CLI socket, and the app-wide state is shared: the vault registry, routing to the focused window, background throttling, and window reloads. Memory, in contrast, is fungible, and the OS reports on it. A Paired Zotero needs no exclusion of its own: each one runs as `--new-instance` with its own profile, data dir, and ports.

So admission has two parts, both per user and machine-wide, under `/tmp/zotlit-desktop-<uid>/`:

```text
pnpm test / verify / e2e / a bare vitest run
  └─ Memory Gate: once per top-level invocation; nested runs skip it
       macOS: pressure level 1 · Windows/Linux: commit ≤ 1.25× physical · 30 s settle

anything that drives the desktop Obsidian
  1. join the Desktop Queue (FIFO; only the head claims)
  2. claim the Desktop Slot (one slot)
  3. pass the Memory Gate
  4. the Lease starts → run → release
  Steps 1–3 share one Admission Deadline (about 9 min by default); on expiry the waiter exits 75 and prints the holder and the queue
```

Each holder enforces its own Lease by ending its process group. When a Lease plus a grace period has passed and the holder is still there, the head waiter evicts it, after checking the pid's start time. Default Leases: `pnpm e2e` 20 min, `e2e:worker` 10 min, `measure:query` 2 h. Manual holds and `pnpm fixture open|dev` must state `--for`, capped at 60 min. A holder may extend its Lease only while nobody is waiting. A child that reuses its parent's hold lives inside the parent's Lease.

## Considered options

- **vatt's memory gate alone** (vattention/vatt-repo#1120, #1137): it admits runs on OS memory pressure and tracks nothing after admission. That suits a fungible resource. Here, two runs would interleave inside the one Obsidian app.
- **vatt's named slot pools** (vattention/vatt-repo#1119): rename-claimed slots, liveness checked by pid and boot time, and pools claimed in sorted order. The slot shape is kept. The pools had no order, no waiter deadline, and no lease, and those three gaps caused the 2026-10-21 incident.
- **A larger N for Obsidian**: rejected here because the shared app state above seemed to make two runs steal each other's focus, throttling, and reloads. That was wrong: all three are per window. ADR 0078 adopts a pool of N.
- **Only waiters kill an overdue holder**: that kills another session's processes as routine, not as a last resort. A self-enforced Lease ends the run's own process group cleanly. Eviction by a waiter remains only as a backstop for a hung holder.
- **Unordered waiting**: a waiter whose caller has a 600 s timeout can lose every race. FIFO tickets also make the queue visible.
- **A gate per `vitest run`**: about 17 packages run tests in parallel under one `pnpm test`. A 30 s settle per package would serialize them for more than eight minutes.

## Consequences

- Exit code 75 means "blocked at admission", not a test failure. Agents report it with the holder that the message names.
- A manual hold that forgets to release ends on its own at its Lease. A long debugging walk extends its Lease, or joins the queue again.
- One-shot `obsidian-cli.ts` calls take no slot. A slot per call would deadlock behind the very run being debugged. The debugging skills tell the agent to wrap a walk in `pnpm desktop-slot run`.
- The state lives in `/tmp`, so it clears on reboot, and every clone of the repository shares it.
