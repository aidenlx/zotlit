# Simplicity

KISS — minimum code that solves the problem.

- Module splits follow [Deep modules](pure-logic.md).
- Avoid defensive fallback code for APIs or invariants we depend on. Validate the boundary once, then use it directly.
- If you write 200 lines and it could be 50, rewrite it.
- When reviewing: "Would a senior engineer say this is overcomplicated?" If yes, simplify.
- **Speculative robustness:** a guard, retry, lock or check added for a race or security edge case names its concrete failure: a reproducing test, a log, or an issue. Where the failure is only theoretical, the diff's PR or ticket records the user's agreement after they were told the failure, its likelihood and the complexity cost. Check each new guard in the diff; one with a theoretical failure and no recorded agreement is a finding. An existing guard in the touched code that has only a theoretical failure is reported with that failure, likelihood and cost, for the user to decide.
