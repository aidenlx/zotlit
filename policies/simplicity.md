# Simplicity

KISS — minimum code that solves the problem.

- Keep code local and direct unless abstraction has a concrete payoff.
- Avoid defensive fallback code for APIs or invariants we depend on. Validate the boundary once, then use it directly.
- If you write 200 lines and it could be 50, rewrite it.
- When reviewing: "Would a senior engineer say this is overcomplicated?" If yes, simplify.
