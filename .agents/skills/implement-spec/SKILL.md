---
name: implement-spec
description: "Implement the result of /to-spec and /to-tickets in code."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The issue tracker should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

The goal is the entire spec implemented on a single **integration branch**, with every ticket resolved the way the issue tracker closes work.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for maximum concurrency.

## Steps

1. Read the spec and tickets to understand the task graph.

2. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets - relevant codebase files or external documentation. Ensure the exploration subagent can save files - it should save its markdown notes in a directory outside the repo, accessible by all future subagents. This lets **implementer subagents** focus on implementation rather than exploration.

3. Create the integration branch. If the issue tracker closes work through PRs, or the user asks for one, open a draft PR after the first merge in step 5 (a branch with no commits ahead of main can't open one), marked as closing the spec and tickets.

4. Use **implementer subagents** to implement each ticket, each in its own worktree on its own branch. Create the worktree with `wt switch --create <branch> --base <integration-branch> --no-cd` (the project's pre-start hook bootstraps it) and name its path in the prompt. Each implementer subagent:
   - confirms its worktree is based on the integration branch before starting, and resets onto it if not;
   - calls the Skill tool with `tdd` to build the ticket;
   - adds the ticket’s Fixture Vault page cases (`policies/fixture-pages.md`);
   - merges the integration branch tip into its own branch before reporting done

5. Once an **implementer subagent** completes, run the Standards axis of `code-review` on the ticket's diff (`<integration-branch>...<ticket-branch>`) in a fresh subagent, and send its hard violations back to the implementer. Merge once the axis is clean: merge its work to the integration branch with a **merger subagent**. Then give the ticket its one progress comment and close it, as `docs/agents/issue-tracker.md` describes.

6. If this changes the **frontier** of available tickets, kick off more **implementer subagents** to work on the new tickets. This allows for maximum concurrency.

7. Once all tickets are complete, merge the PR base branch into the integration branch and read the policies and standards that the merge changed. Run the final review and fix round from that merged tip. Call the Skill tool with `code-review` on the integration branch, and call `improve-codebase-architecture` scoped to the integration diff. Confirm each suspected bug in the running app before it counts as a finding; the user picks which architecture candidates to address. Fix all findings in a single **implementer subagent**, each at its **root**: the fix changes the design that let the defect happen — the module that owns the decision, the function every surface should share, the fake that hid it — and a local patch stands only where the root is out of scope and recorded as an open point (`policies/root-fixes.md`).

8. If a draft PR exists, mark it ready for review. Otherwise, resolve each ticket the way the issue tracker closes work, and report the integration branch. Notify peer sessions that build on the integration branch once, now that it is done.

9. Clean up all **implementer subagent** worktrees with `wt remove <branch>`; its pre-remove hook deinits submodules. Add `-D` for a branch that `git merge-base --is-ancestor <branch> <integration-branch>` confirms is merged.
