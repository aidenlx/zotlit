---
name: implement-spec
description: "Implement a specification in code."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The goal is a PR which implements the entire spec on a single branch.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for **maximum concurrency**.

Coordinate the task graph **event-first**. Give each subagent only the context its ticket needs; prefer context pointers and a bounded turn fork over the full conversation. While agents run, advance independent work on the active frontier: merge completed tickets, review landed changes, prepare newly unblocked tickets, run checks, or update the coordination note. When no independent work remains, wait once on the authoritative agent or command status with a long, bounded interval. An unchanged timeout completes that checkpoint: remain idle until a meaningful event or switch to another in-scope task instead of starting the same poll again.

## Steps

1. Read the spec and tickets. Read enough to understand the task graph.

2. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets - relevant codebase files or external documentation. Ensure the exploration subagent can save files - it should save its markdown notes in a directory outside the repo, accessible by all future subagents. This lets **implementer subagents** focus on implementation rather than exploration.

3. Create a branch, and a draft PR. The PR should be marked as 'closing' the spec issue and tickets.

4. Use **implementer subagents** to implement each ticket. Each implementer subagent should work in its own worktree, on its own branch. Dispatch is complete when the agent has the ticket pointer, required dependency refs, its worktree and branch, and an explicit completion criterion.

5. Once an **implementer subagent** completes, merge its work to the PR branch with a **merger subagent**. Land each ticket as a single commit (squash merge).

6. If this changes the **frontier** of available tickets, kick off more **implementer subagents** to work on the new tickets. This allows for maximum concurrency. Between agent events, work the remaining frontier; use an event-driven wait only when no independent task can advance the PR.

7. Review each ticket as it lands, not only once at the end. When a ticket's merged work is on the PR branch, run /code-review with the pre-merge state as the fixed point. Fix every issue it raises back in that ticket's worktree. Squash the fix commits into that ticket's implementation commit, so the finished ticket stays one commit on the PR branch, and force-push the rewritten branch. Then update the ticket with a summary of what landed and close it (`gh issue close <number> --reason completed`).

8. Once all tickets are complete, run a final /code-review over the whole PR branch. Fix all issues raised by the code review in a single **implementer subagent**.

9. Mark the PR as ready for review.

10. Clean up all **implementer subagent** worktrees.
