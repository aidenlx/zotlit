# Logging

Effect is the logging API: `Effect.logInfo` and its siblings, with fields through `Effect.annotateLogs` and timing through `Effect.withLogSpan`. LogTape is the legacy API: code that already calls a LogTape logger keeps it until the file is reworked, and in `apps/obsidian` LogTape still carries Effect's records to their sinks. Categories: `["zotlit", "<workspace>", ...]`; see each package's `AGENTS.md` for how a log names its category.

Only an app configures sinks: a library logs and leaves LogTape's configuration to the app that hosts it (in `apps/obsidian`, `layerLogging`).

Packages designed as a third-party contract instead accept a structured-logger port and default it to a no-op, so a consumer keeps its own logging stack. `@zotlit/obsidian-i18n` is the one such package today; see [ADR 0013](../docs/adr/0013-obsidian-i18n-is-one-package-behind-injected-ports.md).

A package that ships into a browser page and into Obsidian carries no logger of its own, and names every decision a host acts on in the value it returns instead — a Problem, a render diagnostic, a connection state — so a page that configures no sink pays no bundle for one. `@zotlit/workbench` is the one such package today; see [its README](../packages/workbench/README.md).

Prefer structured logging (named fields object) over interpolated template strings. For expensive context, pass a lazy callback.
