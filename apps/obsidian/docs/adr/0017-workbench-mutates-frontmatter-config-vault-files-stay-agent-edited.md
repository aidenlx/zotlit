# Workbench mutates Managed Frontmatter configuration; vault files stay agent-edited

The Template Workbench launched read-only, but that posture was never a goal in itself — it existed because every mutable thing the workbench touched (template files) already had a better editing seam: the agent writes the vault file directly. Managed Frontmatter configuration lives in plugin settings (`data.json`), where no such seam exists — hand-editing settings JSON bypasses validation and the plugin's settings lifecycle. So the workbench gains mutation commands for frontmatter field configuration (upsert, remove, reorder), with settings-modal validation parity, while inspection, rendering, and frontmatter evaluation stay side-effect-free and vault files and note content remain out of mutation scope.

## Consequences

- Mutation commands enforce the same rules as the settings modal: reserved keys rejected, expressions compile-checked at write time, and JavaScript-language fields rejected while the JavaScript Templates gate is off (nothing compilable to validate).
- Upsert patches: parameters omitted on an existing field keep their current values, so an expression fix never silently resets a user's merge strategy or language.
