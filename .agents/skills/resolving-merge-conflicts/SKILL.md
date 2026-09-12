---
name: resolving-merge-conflicts
description: "Use when you need to resolve an in-progress git merge/rebase conflict."
---

1. **See the current state** of the merge/rebase. Check git history, and the conflicting files.

2. **Find the primary sources** for each conflict. Understand deeply why each change was made, and what the original intent was. Read the commit messages, check the PRs, check original issues/tickets.

3. **Resolve each hunk.** Preserve both intents where possible. Where incompatible, pick the one matching the merge's stated goal and note the trade-off. Do **not** invent new behaviour. Always resolve; never `--abort`.

4. **Scan for semantic conflicts.** Clean merges break too: one side changes a signature, default, or invariant, and the other side's new code still assumes the old one. List the files each side changed since the merge base, collect the contract changes on each side, and check them against the other side's new callers. Account for every contract change.

5. Discover the project's **automated checks** and run them — typically typecheck, then tests, then format. Fix anything the merge broke.

6. **Finish the merge/rebase.** Stage everything and commit. If rebasing, continue the rebase process until all commits are rebased.
