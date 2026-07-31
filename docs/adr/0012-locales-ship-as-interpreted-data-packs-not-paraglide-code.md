# Locales ship as interpreted data packs, not Paraglide-emitted code

Community-plugin review forbids remote code and bundling every locale grows
`main.js` for all users, yet `project.inlang/` and the Inlang message format
must stay the authoring source of truth. We therefore replace Paraglide's
emitted runtime with a ZotLit-owned build-time compiler (reading the project
through `@inlang/sdk`) that emits typed message wrappers, a bundled English
pack, and one pure-data JSON Language Pack per other locale, executed by a
small eval-free interpreter in the plugin; non-English packs are downloaded
only on explicit user consent from a rolling GitHub release and applied after
restart.

## Considered Options

- **Paraglide locale modules, fetched remotely** — still delivers executable
  JavaScript; fails the review constraint.
- **Bundle every locale** — the `feat/i18n` experiment branch does this with
  an ICU/`use-intl` runtime; rejected as the shipping design because bundle
  size scales with locale count and the authoring model would leave Inlang.
  That branch remains reference material for build integration only.
- **i18next / ICU runtime with dynamic JSON** — loads data fine but migrates
  the message format and authoring workflow.
- **Per-locale plugin builds** — avoids remote anything but multiplies
  distribution artifacts and loses runtime locale selection.

## Consequences

- The compiler and interpreter are owned code, maintained against their own
  contract tests once the one-time Paraglide parity gate is deleted.
- Translations update only with plugin releases; there is no independent
  translation release channel and no version pointer — the pack cache is
  keyed by plugin version, so an update triggers one refetch per device.
- The rolling release named here is superseded by ADR 0018: each plugin release
  tag now carries its own Language Pack assets. The rest of this decision —
  remote, consent-gated, eval-free data packs — stands.
