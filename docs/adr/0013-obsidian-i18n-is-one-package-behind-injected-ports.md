---
status: amended (#1710)
---

# Obsidian i18n is one package behind injected ports

> **Amended (#1710).** The Language Pack Lifecycle moved out of the package
> into each host. The package keeps the compiler, schema, validation,
> interpreter, CLI, Vite integration, and the lifecycle's vocabulary: locale
> resolution (`resolveLocale`), the Situation union, and the Pack Source and
> Locale Catalog types. ZotLit runs the lifecycle (consent, device cache,
> download) as its `LanguagePack` Effect service, with storage, language, and
> HTTP read from the plugin's own capabilities, so the lifecycle's ports and
> ZotLit's port adapter are gone. A host's lifecycle is short and follows its
> own runtime and UI; the security-sensitive part, pack validation, stays in
> the package. The `StructuredLogger` port remains on the generated message
> runtime (`setLogger`).

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

- The browser-safe runtime and lifecycle vocabulary are exported separately
  from Node-only compiler and Vite entry points.
- Generated runtimes own active-pack state independently.
- The workspace package remains private until publication is intentionally
  scheduled, while its API is designed as a third-party contract.
- Logging goes through an injected `StructuredLogger` port with a no-op
  default rather than LogTape, so a consuming plugin is free to pick its own
  logging stack. ZotLit gives the generated message runtime a logger that
  writes through `Effect.log*` under the `i18n` category.
- The compiler emits the Locale Catalog (base locale plus remote pack
  filenames); the consumer supplies the Pack Source (base URL and origin) and
  Locale Aliases, and composes pack URLs. Release policy stays with the
  consumer while facts the compiler already produces are never restated by
  hand.
- The package stays free of any `obsidian` dependency: each host reads
  Obsidian's language and device storage itself.
