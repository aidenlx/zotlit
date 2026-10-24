# Coding standards

Review-only policy index for repository. Load these during standards review. Keep implementation context in `AGENTS.md`.

Record each meaningful agent mistake in the relevant policy on its first occurrence, through `/retro`
or a direct edit. State the expected behavior and what the reviewer must check.

## Policies

- [CLI help](policies/cli-help.md)
- [CLI + skill pair](policies/cli-skill-pair.md)
- [Comments](policies/comments.md)
- [Event naming](policies/event-naming.md)
- [Fixture pages](policies/fixture-pages.md)
- [Function parameters](policies/function-parameters.md)
- [Grouping](policies/grouping.md)
- [Host state](policies/host-state.md)
- [IME input](policies/ime-input.md)
- [Input validation](policies/input-validation.md)
- [Lint plugins](policies/lint-plugins.md)
- [Logging](policies/logging.md)
- [Observability](policies/observability.md)
- [Package and workspace roots](policies/package-roots.md)
- [Deep modules](policies/pure-logic.md)
- [Regex](policies/regex.md)
- [Resource disposal](policies/resource-disposal.md)
- [Root fixes](policies/root-fixes.md)
- [Simplicity](policies/simplicity.md)
- [Tautological tests](policies/tautological-tests.md)
- [Temporal dates](policies/temporal-dates.md)
- [Test isolation](policies/test-isolation.md)
- [Test timing](policies/test-timing.md)
- [Testing strategy](policies/testing-strategy.md)
- [UI testing](policies/ui-testing.md)
- [Vocabulary](policies/vocabulary.md)

## Shared desktop app

- A diff that changes how desktop runs share the Obsidian app — its windows, focus, the vault registry, the clipboard, or admission — updates `packages/e2e/AGENTS.md`, `packages/e2e/policies/os-focus.md`, and ADRs 0077 and 0078 (`docs/adr/`) in the same diff, so each still agrees with the code.

## Internal state

- ECMAScript private fields and methods (`#field`, `#method`) for internal state. Avoid TypeScript `private` for service internals.
