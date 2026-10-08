# CLI help

Help text and reference live in code, generated from the same registries the handlers use.

## Node.js scripts

Use yargs for argument parsing. The epilogue carries the detailed reference, built from the same constants the handlers run — agents read `--help` for the full contract.

## Obsidian CLI

Expose a guide subcommand that renders reference sections from the handler's own constants and vocabularies — the Template Workbench `guide.ts` is the pattern.

Register each handler through the plugin's `registerCliHandler`, and reject with an `Error` whose message the caller can act on. `ZotLitPlugin.registerCliHandler` turns every rejection into its message text, which Obsidian prints as `Error: <message>` (`apps/obsidian/src/lib/cli-rejection.ts`).

## Placement

CLI help text and reference live next to the implementation, in the same package, as hardcoded English. A help string built from exported constants stays current when the constants change.
