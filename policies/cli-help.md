# CLI help

Help text and reference live in code, generated from the same registries the handlers use.

## Node.js scripts

Use yargs (or a hand-built `usage` string from exported constants) for `--help`. Use `marked-man` to produce roff man pages from the same source when the script is distributed globally.

## Obsidian CLI

Obsidian's CLI API cannot shell out to yargs or serve man pages. Expose a guide subcommand that renders man-page-style sections from the handler's own constants and vocabularies — the Template Workbench `guide.ts` is the pattern.

## Where docs live

CLI guide text and usage strings live next to the implementation, in the same package. They are hardcoded English, never sourced from i18n. A usage string built from exported constants stays current when the constants change; a separate Markdown file restating the same facts is a cache that drifts silently.
