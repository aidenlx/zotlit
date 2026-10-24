# Logging

Effect is the logging API: `Effect.logInfo` and its siblings, with fields through `Effect.annotateLogs` and timing through `Effect.withLogSpan`. Categories: `["zotlit", "<workspace>", ...]`; see each package's `AGENTS.md` for how a log names its category.

LogTape is the sink backend: in `apps/obsidian`, `layerLogging` configures it and `logTapeLogger` carries Effect's records to its sinks. A legacy file that already calls a LogTape logger keeps it until the file is reworked, and the change that reworks it moves its logs to Effect in the same diff.

The ZoteroReads worker logs through Effect, and its records travel to the renderer over a port. The host re-emits them into the renderer's Effect logger, so the plugin's sinks and log level apply to them unchanged, and each record keeps the time the worker logged it (`LogTimestamp`).

An app-agnostic library without Effect in a file can call `logLibrary` from `@zotlit/shared/logging`. The sink is a module global of one JavaScript realm, and the realm's entry installs it: importing the renderer's `lib/effect-log.ts` bridge (every Effect entry point does), or the ZoteroReads log port while that worker runs. A realm that runs a `logLibrary` caller (today the `@zotlit/db` readers of Zotero rows) installs a sink before it does; one that imports only `@zotlit/db` helpers that never log (the citation-parse worker, the Zotero plugin, `@zotlit/workbench` pages) needs none.

Only an app configures sinks: a library logs and leaves LogTape's configuration to the app that hosts it (in `apps/obsidian`, `layerLogging`).

Packages designed as a third-party contract instead accept a structured-logger port and default it to a no-op, so a consumer keeps its own logging stack. `@zotlit/obsidian-i18n` is the one such package today; see [ADR 0013](../docs/adr/0013-obsidian-i18n-is-one-package-behind-injected-ports.md).

A package that ships into a browser page and into Obsidian carries no logger of its own, and names every decision a host acts on in the value it returns instead — a Problem, a render diagnostic, a connection state — so a page that configures no sink pays no bundle for one. `@zotlit/workbench` is the one such package today; see [its README](../packages/workbench/README.md).

Prefer structured logging (named fields object) over interpolated template strings. For expensive context, pass a lazy callback.
