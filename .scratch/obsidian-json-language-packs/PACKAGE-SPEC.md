# Spec: Extract Obsidian JSON Language Packs into a reusable package

Status: ready-for-agent
Date: 2026-07-28
Depends on: JSON Language Packs for the Obsidian plugin

## Problem Statement

ZotLit's JSON Language Pack implementation is complete, but its compiler,
pack contract, interpreter, lifecycle, and build integration live inside the
Obsidian app. That placement makes a cohesive, security-sensitive subsystem
look app-specific, leaves its reusable boundaries implicit, and prevents
another Obsidian plugin from adopting the same eval-free Inlang-to-JSON
workflow without copying ZotLit code.

The current implementation also carries app-local assumptions that do not
belong in a reusable contract: ZotLit imports and logging, a package-global
runtime, fixed repository paths, an English-specific fallback vocabulary, a
hard-coded `messages/<locale>.json` source layout, and Vite integration
embedded in the app configuration.

## Solution

Extract the implemented subsystem into one private workspace package named
`@zotlit/obsidian-i18n`, designed around a publishable third-party API. The
package owns the Inlang compiler, Language Pack schema and validation,
interpreter, configurable headless Language Pack Lifecycle, CLI, and Vite
integration. It remains purpose-built for Obsidian plugins rather than
becoming a general-purpose i18n framework.

Each consumer compiles its own Inlang project into a typed Message facade, an
isolated generated runtime, and one JSON Language Pack per locale. The
consumer supplies release policy, pack locations, Locale Aliases, plugin
version, cache namespace, Obsidian-facing ports, logging, and rendered UI.
ZotLit's generated output and user-visible behavior remain unchanged by the
move.

## User Stories

1. As a ZotLit maintainer, I want the Language Pack subsystem owned by one
   workspace package, so that its compiler and runtime contract have one clear
   home.
2. As an Obsidian plugin developer, I want to reuse the package without
   depending on ZotLit services, so that I can adopt JSON Language Packs in
   another plugin.
3. As a package consumer, I want a browser-safe main entry, so that importing
   runtime behavior cannot pull Node-only compiler code into my plugin bundle.
4. As a build-tool author, I want Node-only compiler and Vite entry points, so
   that environment boundaries are explicit.
5. As a maintainer, I want the pack schema, compiler, validator, interpreter,
   and lifecycle versioned together, so that compatible behavior cannot drift
   across packages.
6. As a maintainer, I want the workspace package to remain private initially,
   so that extraction does not accidentally publish an unreviewed API.
7. As a future publisher, I want the private package already shaped as a
   third-party contract, so that publication does not require removing hidden
   ZotLit coupling later.
8. As an application developer, I want each generated project to own an
   isolated runtime, so that active locale state cannot leak between projects
   or consumers.
9. As an application developer, I want generated Message functions to keep
   their current names and input types, so that extraction does not require
   call-site rewrites.
10. As a translator, I want the existing Inlang project and JSON message
    format to remain the authoring source, so that extraction does not change
    translation workflow.
11. As a package consumer, I want the compiler to honor the Inlang project's
    configured catalog paths, so that it does not impose ZotLit's repository
    layout.
12. As a package consumer using multiple catalog patterns, I want the compiler
    to honor their merge precedence, so that generated output matches Inlang's
    loaded project.
13. As a developer diagnosing a Message error, I want diagnostics attributed
    to the effective source catalog, so that I can edit the winning definition.
14. As a community-plugin reviewer, I want raw source markup rejected before
    output is emitted, so that the eval-free, string-only Message contract
    remains explicit even when the pinned Inlang importer loses markup
    provenance.
15. As a package consumer, I want compilation errors to leave the previous
    complete generated output intact, so that a failed watch iteration does
    not corrupt my development build.
16. As a developer using watch mode, I want byte-identical artifacts left
    untouched, so that generation does not trigger rebuild loops.
17. As a developer removing a locale, I want its stale generated pack removed,
    so that the output directory represents the current project exactly.
18. As a monorepo maintainer, I want project and output paths resolved from an
    explicit root, so that nested packages do not depend on process location.
19. As a plugin sharing one Inlang project with another surface, I want to
    exclude Message prefixes consistently through API, CLI, and Vite, so that
    unrelated Messages never enter my plugin artifacts.
20. As a non-Vite consumer, I want a compile CLI with watch support, so that I
    can use the package without writing a custom generator script.
21. As a Vite consumer, I want generation, source watching, and optional local
    pack serving in one integration, so that the normal development loop needs
    no app-local compiler plugin.
22. As a plugin developer, I want the local pack server disabled by default and
    explicitly activated by my build configuration, so that development
    network behavior remains intentional.
23. As a runtime consumer, I want fallback defined against the configured base
    locale rather than English, so that the package supports any valid Inlang
    base locale.
24. As a ZotLit user, I want English fallback behavior to remain exactly as it
    is today, so that extraction causes no visible localization change.
25. As a plugin developer, I want locale types inferred from one catalog of the
    base locale, packs, and aliases, so that invalid Locale Alias targets fail
    type checking.
26. As a plugin user with an unsupported Obsidian language, I want resolution
    to fall back to the consuming plugin's base locale, so that the plugin
    remains usable.
27. As a plugin developer, I want the lifecycle to accept language, device
    storage, and HTTP ports, so that it remains testable and independent of
    ZotLit services.
28. As a plugin author, I want to retain control of consent copy, notices, and
    settings UI, so that the package does not impose another plugin's branding
    or interface.
29. As a multi-plugin user, I want each plugin's cached packs and consent state
    namespaced, so that their device-local data cannot collide.
30. As an updating user, I want the current version-scoped cache and persistent
    consent behavior preserved, so that plugin updates refresh packs exactly as
    they do now.
31. As a security-conscious maintainer, I want downloaded and cached JSON
    validated before installation, so that untrusted data never enters the
    interpreter.
32. As a performance-conscious maintainer, I want validated packs trusted by
    the synchronous interpreter, so that translation does not repeat structural
    validation.
33. As a package consumer with another delivery channel, I want public
    Language Pack validation, so that I can establish the same trust boundary.
34. As a developer using datetime Messages, I want generated input types to
    retain Temporal support without importing ZotLit shared code, so that the
    facade remains portable.
35. As an application maintainer, I want to supply my existing structured
    logger or use a no-op default, so that the package does not require
    LogTape.
36. As a maintainer, I want existing compiler, runtime, lifecycle, and UI
    behavior covered at stable external seams, so that moving files does not
    turn implementation details into tests.
37. As a domain maintainer, I want Message and Language Pack vocabulary owned
    by the extracted context, so that the Obsidian app consumes one canonical
    language.

## Implementation Decisions

### Package boundary

- Use one workspace package named `@zotlit/obsidian-i18n`.
- Design its API as publishable, but keep the package private until
  publication is scheduled explicitly.
- Keep the main entry browser-safe. It exports the runtime factory, lifecycle
  factory, Language Pack validation, and public types.
- Export Node-only compilation and persistence from a compiler subpath.
- Export Vite integration from a Vite subpath, with Vite as an optional peer
  dependency.
- Add no further subpaths until an independent consumer demonstrates a need.
- Keep pack grammar, formatter support, validation limits, and interpretation
  semantics as one fixed, versioned contract.

### Compiler surface

- Expose a high-level compile operation that loads an Inlang project, compiles
  it, and persists output.
- Expose an in-memory project compiler that accepts both a loaded Inlang
  project and normalized raw source catalogs carrying locale, path, contents,
  and merge precedence.
- Expose change-aware output persistence separately.
- Return generated artifacts, written paths, Message count, and structured
  compiler reports. Keep lower-level bundle, Message, pattern, and AST
  normalization helpers internal.
- Preserve the existing compiler reports for untranslated Messages,
  translation inputs absent from the base locale, and Messages absent from the
  base locale. Formatting is shared by CLI and Vite callers.
- Resolve project and output paths from an explicit root. The high-level API
  and CLI default that root to the current working directory; Vite supplies its
  resolved project root.

### Source catalogs and diagnostics

- Require Inlang's JSON message-format plugin.
- Discover source catalogs through the loaded plugin's file-discovery hook
  rather than assuming a directory.
- Honor one or multiple configured path patterns and the plugin's merge
  precedence.
- Use raw source catalogs for markup rejection because the currently pinned
  message-format importer does not preserve markup as markup nodes in the
  normalized project.
- Apply raw-source checks through the in-memory compiler as well as the
  high-level filesystem operation; no public compiler path has weaker
  validation.
- Attribute a Message-level diagnostic to the highest-precedence source that
  defines the effective key. Locale-wide diagnostics retain all contributing
  paths.
- Include line and column where raw source permits it; otherwise retain the
  nearest file or project location.
- Select Messages through an excluded-prefix list, empty by default. ZotLit
  excludes the docs prefix.

### Generated artifacts and persistence

- Emit `messages.ts`, `runtime.ts`, and one `<locale>.json` pack into a
  dedicated compiler-owned output.
- Preserve the current typed Message facade and JSON pack representation.
- Generate a runtime module that creates one isolated interpreter from the
  project's base pack. It exports the runtime object and a bound translation
  function used by generated Message wrappers.
- Generate datetime inputs against a package-owned public type instead of a
  ZotLit shared-module type.
- Compile all artifacts successfully before persistence begins.
- Skip byte-identical writes.
- Reconcile the dedicated output after successful compilation, removing stale
  generated artifacts such as packs for removed locales.
- Leave the previous complete output intact when compilation fails.

### Runtime and validation

- Replace package-global locale state with a runtime factory. Each instance
  owns its base pack, active pack, translation function, and fallback-log
  deduplication.
- Use base-locale and base-pack terminology throughout the package. ZotLit
  continues to configure English as its base locale.
- Preserve current rendering, interpolation, variant selection, formatter,
  fallback, and error containment behavior.
- Depend directly on the Temporal polyfill and export a portable datetime
  input type.
- Validate every compiler-emitted pack.
- Validate cached and downloaded JSON at the Language Pack Lifecycle boundary.
- Let the interpreter accept an already validated Language Pack without
  repeating structural validation.
- Keep Language Pack validation and the schema-version error public, including
  the distinction that a higher numeric schema version may require a plugin
  update.
- Accept an optional minimal structured logger and use a no-op logger by
  default.

### Language Pack Lifecycle

- Keep locale resolution, consent, device cache, download, restart-required
  state, and subscription behavior in the package as a headless lifecycle.
- Construct the lifecycle from one locale catalog containing the base locale,
  available remote packs, and Locale Aliases.
- Infer the valid locale union from the base locale and pack keys, and
  constrain Locale Alias targets to that union.
- Resolve unmatched Obsidian language codes to the base locale.
- Accept the generated runtime, plugin version, cache namespace, locale
  catalog, language/storage/HTTP ports, and logger from the consumer.
- Preserve current installed, cached, and unavailable state behavior,
  persistent accept/decline consent, automatic version-triggered refresh, and
  restart-before-activation behavior.
- Build pack keys as
  `<namespace>:i18n:pack:<pluginVersion>:<locale>` and consent keys as
  `<namespace>:i18n:consent:<locale>`. ZotLit uses the `zotlit` namespace,
  preserving existing device-local data.
- Keep pack URLs, filenames, origins, release lineage, notices, settings copy,
  and rendered UI under consumer control.
- Import no ZotLit service, LogTape, or Obsidian runtime module.
- Add no direct Obsidian adapter in version one; the injected ports are the
  smaller integration boundary.

### CLI and Vite integration

- Ship an `obsidian-i18n compile` command.
- Support project, output, excluded-prefix, and watch options.
- Have CLI and Vite integration call the same high-level compiler operation.
- Keep Vite's full configuration programmatic; add no separate package config
  file.
- Have Vite compile at build start, watch the discovered project inputs,
  suppress identical rewrites, and exclude generated output from its watcher.
- Optionally serve generated packs over loopback during development. The
  consumer controls activation and supplies production pack locations.
- Add no interactive initialization command in version one.

### ZotLit migration

- Move compiler, pack contract, validation, interpreter, headless lifecycle,
  CLI, and reusable Vite behavior into the package.
- Keep ZotLit's locale catalog, GitHub release locations, Locale Aliases,
  plugin version, cache namespace, port wiring, logging adapter, notices,
  settings copy, and rendered settings UI in the Obsidian app.
- Keep generated artifacts inside the consuming app and continue ignoring them
  as build output.
- Preserve the current Message import shape and all user-visible Language Pack
  behavior.
- Update the localization domain context during implementation: the package
  owns Message, Message Input, Language Pack, Language Pack Lifecycle, and
  Locale Alias; the Obsidian app references those canonical definitions.

## Testing Decisions

- Tests assert external behavior through the highest stable seam. Compiler
  tests operate through in-memory project compilation or the high-level
  compile operation; runtime tests translate through the public runtime;
  lifecycle tests use injected ports and observe returned state and actions.
- Package-owned compiler fixtures cover deterministic facade and pack output,
  base-locale input contracts, partial locales, prefix exclusion, multiple
  source patterns and precedence, raw markup rejection, unsupported
  constructs, source-attributed diagnostics, and stale-output reconciliation.
- Compiler persistence tests verify that failed compilation preserves the
  previous output, byte-identical output is not rewritten, and removed locales
  remove stale packs.
- Generated-code contract tests execute or type-check the public generated
  facade and isolated runtime rather than asserting incidental source text.
- Runtime tests preserve coverage of plain Messages, interpolation, variants,
  number/plural/datetime formatting, active-pack fallback, base-pack fallback,
  bundle-ID fallback, error containment, and isolated state across two runtime
  instances.
- Validation tests cover schema version, locale, exact node shapes, formatter
  allowlisting, size/count/text/depth limits, and the public
  update-needed classification.
- Lifecycle tests cover locale and alias resolution, namespaced cache hits and
  misses, consent acceptance and decline, automatic refresh after plugin
  version changes, download and cache failures, concurrent refresh visibility,
  restart-required state, and session-stable activation.
- CLI tests exercise the command as a process-facing seam: option parsing,
  one-shot output, watch inputs, warnings, and failure exit behavior.
- Vite tests exercise plugin hooks through a minimal fixture: initial
  generation, watched source changes, generated-output exclusion, warning
  forwarding, and opt-in loopback pack serving.
- Package tests use package-owned fixture projects and catalogs.
- The Obsidian app retains one integration contract that compiles the real
  ZotLit Inlang project and exercises representative generated Messages. This
  catches configuration and wiring drift without making the reusable package
  tests depend on ZotLit's catalog.
- The Obsidian app retains notice, settings-copy, and declarative/compat
  settings integration tests because those are consumer-owned UI seams.
- Existing compiler, runtime, validation, and lifecycle tests are moved to the
  package where their behavior becomes package-owned; their assertions remain
  behavior-focused.
- Prior art is the current generator fixture suite, runtime interpreter suite,
  lifecycle port tests, Vite generation hook, and other workspace packages'
  built-library test configuration.

## Out of Scope

- Publishing `@zotlit/obsidian-i18n` to a registry.
- Supporting non-Obsidian application lifecycles.
- Becoming a general-purpose replacement for Paraglide.
- Supporting Inlang source plugins other than the JSON message-format plugin.
- Changing the Language Pack schema, formatter set, limits, or fallback ladder.
- Changing consent, cache, refresh, download, restart, or distribution policy.
- Changing ZotLit's Language Pack URLs or rolling-release workflow.
- Changing user-facing notice or settings copy.
- Resolving the separate target-language hint-text question.
- Adding markup or a parts API.
- Adding a direct Obsidian adapter.
- Adding interactive project scaffolding.
- Splitting compiler, runtime, lifecycle, or Vite behavior into separately
  versioned packages.
- Publishing generated packs independently from plugin releases.
- Redesigning behavior discovered during extraction; such changes require
  separate follow-ons.

## Further Notes

- The existing JSON Language Pack spec remains authoritative for user-visible
  behavior and pack semantics. This spec governs ownership and reusable API
  boundaries.
- Paraglide provides the reference shape: one compiler package, a shared
  high-level compile operation used by CLI and bundler integration, and
  project-local generated runtime modules. This package keeps ZotLit's
  interpreted JSON contract and Obsidian lifecycle rather than adopting
  Paraglide's emitted locale code or web routing runtime.
- The current Inlang project configures its catalog path through the JSON
  message-format plugin. Catalog location is therefore discovered from the
  loaded plugin rather than inferred from repository layout.
- The pinned message-format importer loses markup provenance, and the Inlang
  database retains no source path or offset. Raw catalogs remain part of the
  compilation input so the package can preserve strict rejection and useful
  diagnostics.
- The package-boundary trade-off is recorded in ADR 0013, “Obsidian i18n is
  one package behind injected ports.”
