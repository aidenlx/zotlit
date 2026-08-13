# CLI text

Every string a `zotlit:*` CLI command outputs — command and flag descriptions in
`register.ts`, guide bodies, diagnostic messages — is a hardcoded English literal
in source, never sourced from the Language Pack facade (`m.*`).

- The CLI is an agent-facing contract surface, not UI a person reads while
  using the plugin. Guide bodies were always hardcoded this way; command and
  flag descriptions follow the same rule.
- Do not add `cli_*` keys to `messages/*.json` or call `m.cli_*` from a
  `register.ts`, a `guide.ts`, or a CLI handler.
