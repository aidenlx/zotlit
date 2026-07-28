# TODO / open follow-on questions

## Hint UI text in the target language

Status: resolved — see
[.scratch/target-locale-messages/SPEC.md](../target-locale-messages/SPEC.md)
and [ADR 0014](../../docs/adr/0014-lifecycle-copy-renders-as-bundled-target-locale-messages.md).

Outcome of the grilling session: general tooltips/`aria-label` hints keep the
fallback ladder (works as designed). The real itch was the Language Pack
consent/lifecycle copy, which rendered in English at the exact moments it
matters. That copy becomes Target-Locale Messages — prefix-selected Messages
bundled per locale into `main.js` and rendered unconditionally in the resolved
locale, naming languages by their Endonym. No ticket; the spec is the record.

## Extract the compiler/runtime into `packages/`

Status: resolved — see [PACKAGE-SPEC.md](./PACKAGE-SPEC.md) and
[ADR 0013](../../docs/adr/0013-obsidian-i18n-is-one-package-behind-injected-ports.md).

The JSON language pack compiler (Inlang project → typed facade + packs) and
the runtime interpreter currently live inside `apps/obsidian`. Consider
extracting them into a standalone workspace package under `packages/` —
mirroring how Paraglide ships as its own decoupled library rather than living
inside a single app — so the compiler/runtime pair could be reused by other
Obsidian plugins, not just ZotLit. Stays Obsidian-specific (not a
general-purpose i18n library like Paraglide itself).

### Settled boundary

- Design the package around a publishable third-party contract, while keeping
  the workspace package private until publication is intentionally scheduled.
- The package owns the compiler, pack schema and validation, interpreter, Vite
  integration, and configurable headless Obsidian lifecycle: locale
  resolution, consent state, device cache, download, and restart-required
  state. ZotLit supplies pack URLs, locale aliases, cache namespace, plugin
  version, ports, logging, and rendered UI and copy.
- Extraction preserves the current generated facade and packs, fallback and
  validation semantics, consent and cache behavior, and test coverage.
  Behavioral redesigns remain separate follow-ons.
- Use one workspace package with compiler, runtime, lifecycle, and Vite
  subpath exports. The pack schema evolves across those parts as one contract.
- The lifecycle accepts package-owned ports for language lookup, device
  storage, and HTTP rather than depending on ZotLit service types or calling
  Obsidian APIs directly. A thin Obsidian adapter belongs in the package only
  where it removes meaningful consumer boilerplate.
- The configurable Vite integration compiles, watches source inputs, suppresses
  identical rewrites, and optionally serves generated remote packs during
  development. The consumer controls activation and supplies production pack
  URLs.
- Use `packages/obsidian-i18n` with the package name
  `@zotlit/obsidian-i18n`.
- Generate a project-local `runtime.ts` beside `messages.ts` and the locale
  JSON files. It creates an isolated interpreter from the project's bundled
  base pack; generated message wrappers call that instance. The package
  exports the interpreter factory rather than keeping package-global active
  locale state.
- The public compiler surface has `compile(options)` for project loading and
  persistence, `compileProject(input, options)` for in-memory artifact
  generation, and `writeOutput(artifacts, outdir)` for change-aware
  persistence, plus diagnostic and report types and formatting. Lower-level
  bundle, Message, and AST normalization helpers remain internal.
- Configuration covers project and output locations, Message selection, Vite
  watching, lifecycle policy, and pack locations. Pack grammar, formatter
  allowlist, validation limits, and interpretation semantics remain one fixed,
  versioned contract.
- Keep the root `@zotlit/obsidian-i18n` entry browser-safe, exporting the
  runtime factory, lifecycle factory, validation, and public types. Export
  Node-only compilation and persistence from `./compiler`, and Vite
  integration from `./vite`. Add further subpaths only for a demonstrated
  independent consumer.
- ZotLit constructs the lifecycle with its generated runtime and supplies the
  base locale, plugin version, cache namespace, aliases, available packs,
  language/storage/HTTP ports, and logger. The lifecycle returns the existing
  headless state and subscription surface; release policy and UI remain app
  configuration.
- Depend directly on `@js-temporal/polyfill` at runtime and expose a
  package-owned `DatetimeInput` type for generated facades. The published
  compiler depends on `@inlang/sdk`; Vite is an optional peer for `./vite`.
  The package has no LogTape, ZotLit, or direct Obsidian runtime dependency.
  It accepts an optional minimal structured logger with a no-op default.
  Version one has no Obsidian adapter because the three injected ports are
  already the smaller boundary.
- Ship an `obsidian-i18n compile` command with project, output,
  excluded-prefix, and watch options. CLI and Vite integration call the same
  `compile()` API; Vite accepts the full programmatic options. Version one has
  no interactive `init` scaffolding.
- Message selection uses
  `excludeMessagePrefixes: readonly string[]`, empty by default; ZotLit
  supplies `["docs_"]`. The same option works through the compiler API, CLI,
  and Vite integration.
- The output path is a dedicated compiler-owned directory. After a successful
  compile, persistence skips byte-identical writes and removes stale generated
  artifacts. Compilation failure leaves the previous complete output intact.
- Generated `runtime.ts` exports one isolated `runtime` object created from the
  generated base pack, plus a bound `translate` function consumed by
  `messages.ts`. Runtime-local state includes the active pack and fallback-log
  deduplication; the app passes the instance to the lifecycle.
- Package terminology and behavior use the Inlang project's base locale and
  base pack rather than assuming English. ZotLit continues to use English, so
  its observable behavior is unchanged.
- The lifecycle constructs device-storage keys from a required consumer
  namespace: `<namespace>:i18n:pack:<pluginVersion>:<locale>` for packs and
  `<namespace>:i18n:consent:<locale>` for consent. ZotLit supplies `zotlit`,
  preserving its current keys.
- One catalog supplies the base locale, available packs, and Locale Aliases.
  The lifecycle factory infers its locale union from the base locale and pack
  keys, constrains alias targets to that union, and resolves unmatched Obsidian
  language codes to the base locale.
- Validate only at trust boundaries: the compiler validates every emitted
  pack, and the lifecycle validates cached and downloaded JSON before
  installation. The interpreter accepts an already validated `LanguagePack`.
  `validateLanguagePack()` remains public for consumers with another loading
  channel.
- Require Inlang's JSON message-format plugin and discover source catalogs
  through its `toBeImportedFiles({ settings })` hook. Honor single and multiple
  configured path patterns and their merge precedence; do not accept a second
  messages-directory option that could disagree with the Inlang project.
- `compile()` and the CLI resolve project and output paths from an explicit
  root, defaulting to the current working directory. The Vite adapter supplies
  Vite's resolved project root. ZotLit supplies its monorepo root explicitly.
- `compileProject()` accepts a filesystem-free compilation input containing
  both the loaded Inlang project and its discovered raw source catalogs
  (`locale`, path, contents, and merge precedence). `compile()` performs
  loading and source discovery before calling it, so every entry point applies
  the same raw-source markup checks.
- Structured diagnostics retain source provenance. A Message overridden across
  catalogs is attributed to the highest-precedence source containing its key;
  locale-wide reports retain all contributing source paths. Diagnostics include
  line and column where raw source identifies them, otherwise the file or
  project location.
- Package-owned fixtures cover the compiler, schema, validation, interpreter,
  lifecycle, CLI, and Vite integration. The Obsidian app retains one
  real-project generation contract test plus its notice and settings
  integration tests.
- During extraction, move Message, Message Input, Language Pack, Language Pack
  Lifecycle, and Locale Alias into the new package context glossary, add that
  context to the Context Map, and have the Obsidian app reference its
  vocabulary.

Ready to decompose into tickets.
