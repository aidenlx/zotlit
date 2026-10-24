# Lint plugins

A custom oxlint plugin (`packages/config/oxlint-plugin-*.ts`, `apps/*/scripts/oxlint-plugin-*.ts`) describes itself, so a reader learns what a rule does and why from the code that enforces it. The reviewer checks, for each plugin a diff adds or changes:

- **Plugin header.** The file opens with a comment that says what area the plugin covers and where its rule tests live.
- **Rule doc.** Each rule has a JSDoc above it. The JSDoc says what the rule rejects and what the preferred pattern guarantees that the rejected one lacks, and links the policy the rule enforces. `meta.docs.description` gives that in one line, and the message names the fix.
- **Config.** `oxlint.config.ts` switches rules on and holds their backlog lists. A backlog comment says only why the files are listed and when one leaves. The rule's rationale stays in the plugin.
- **Prose.** A policy, a skill, or `AGENTS.md` mentions a lint-enforced rule in at most one line that points at the plugin. Judgement calls the rule cannot see stay in the prose.
