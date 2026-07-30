# Workbench guidance lives in the CLI; the Agent Skill stays thin

The first Template Workbench skill (#563) was a 294-line document carrying flag
tables, value lists, and a nine-row diagnostics table — tooling facts that
drift from the code, held honest only by a generated digest and a CI staleness
check. We decided the plugin itself is the home of every tooling fact: command
help and the tiered Workbench Guide command (`zotlit:template-guide`, default
quickstart plus `topic=` sections) draw their value lists from the same
canonical registries the handlers use, and each diagnostic envelope carries a
literal-English recovery `hint`, so corrective guidance arrives at the moment
of failure at zero standing context cost. The skill at
`skills/zotlit-template/SKILL.md` is thin hand-authored process, policy, and
safety with pointers into the CLI — it has no facts left to go stale.

Distribution is dual-channel. The `skills` CLI discovers
`skills/<name>/SKILL.md` directly from the GitHub repo. The docs site serves
only the well-known Agent Skills index, built by a route handler at docs build
time: the entry's `url` points at `raw.githubusercontent.com` pinned to the
build's commit SHA, and the mandatory sha256 `digest` is computed from the
in-repo file at that same checkout, so pin and digest can never disagree. The
docs site hosts no artifact copy; the generator script, the committed
`public/.well-known/` artifacts, and the CI regeneration check from #563 are
gone.

## Consequences

- Guide and hint edits ship with a plugin release; skill edits reach the git
  channel immediately and the well-known channel on the next docs deploy
  (which moves the pin).
- Guide output and diagnostic prose are literal English, the agent-facing
  machine surface; command and flag descriptions stay localized help text.
- A domain install needs the scheme (`npx skills add
  https://zotlit.aidenlx.site`); the skills CLI parses a bare domain as a git
  source.
