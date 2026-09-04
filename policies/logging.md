# Logging

LogTape for all runtime logging. Categories: `["zotlit", "<workspace>", ...]`; see each package's `AGENTS.md` for the import path.

Libraries only `getLogger()` — never `configure()` (that's the app's job).

Packages designed as a third-party contract instead accept a structured-logger port and default it to a no-op, so a consumer keeps its own logging stack. `@zotlit/obsidian-i18n` is the one such package today; see [ADR 0013](../docs/adr/0013-obsidian-i18n-is-one-package-behind-injected-ports.md).

A package that ships into a browser page and a Worker carries no logger of its own, and names every decision a host acts on in the value it returns instead — a Problem, a render diagnostic, a connection state — so a page that configures no sink pays no bundle for one. `@zotlit/workbench` is the one such package today; see [its README](../packages/workbench/README.md).

Prefer structured logging (named fields object) over interpolated template strings. For expensive context, pass a lazy callback.
