# Obsidian i18n is one package behind injected ports

The JSON Language Pack compiler, schema, validation, interpreter, headless
Obsidian lifecycle, CLI, and Vite integration live together in
`@zotlit/obsidian-i18n`. The compiler emits an isolated runtime for each
consumer project, while the lifecycle accepts language, device-storage, HTTP,
and logging ports; consuming plugins retain their pack locations, release
policy, and rendered UI. This keeps the security-sensitive pack contract
versioned as one unit without coupling the reusable package to ZotLit or
package-global locale state.

## Considered Options

- **Extract only the compiler and interpreter** — leaves the
  Obsidian-specific consent, cache, and restart lifecycle duplicated by every
  consuming plugin.
- **Split compiler, runtime, and lifecycle packages** — introduces coordinated
  versioning around one pack schema without an independent consumer for any
  part.
- **Import Obsidian and render notices/settings inside the package** — couples
  reusable lifecycle policy to one UI and copy surface.

## Consequences

- The browser-safe runtime and lifecycle are exported separately from
  Node-only compiler and Vite entry points.
- Generated runtimes own active-pack state independently.
- The workspace package remains private until publication is intentionally
  scheduled, while its API is designed as a third-party contract.
- Logging goes through an injected `StructuredLogger` port with a no-op
  default rather than LogTape, so a consuming plugin is free to pick its own
  logging stack. ZotLit adapts its LogTape logger at the lifecycle boundary.
- The compiler emits the Locale Catalog (base locale plus remote pack
  filenames); the consumer supplies the Pack Source (base URL and origin) and
  Locale Aliases, and the lifecycle composes pack URLs. Release policy stays
  with the consumer while facts the compiler already produces are never
  restated by hand.
- ZotLit's production port adapter carried zero translation logic — Obsidian
  module functions and `this.app` bindings passed through verbatim. When a
  second consumer appears, a package-owned `obsidianPorts(app)` helper in an
  `/obsidian` subpath is the pre-approved shape; until then the package stays
  free of any `obsidian` dependency.
