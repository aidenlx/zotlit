---
name: zotlit-template
description: "Use when authoring or debugging ZotLit templates through the Obsidian CLI Template Workbench."
---

# ZotLit Template Workbench

## CLI pointers

Use `obsidian help zotlit` as the source of truth for commands and flags.

Use `zotlit:template-guide` as the source of truth for workbench contracts and concrete
invocations.

For every structured response, test `ok`. When it is `false`, follow `diagnostic.hint`.

## Safety model

Keep rendered output in memory.

The Template file edit is the only planned vault write. Read the active file first, then
preserve unrelated content.

Eta is full-privilege JavaScript. Rendering an Eta Template executes vault-provided code with
Obsidian's privileges.

## Workbench loop

1. Run `zotlit:template-status`. Confirm the vault and Zotero source paths.
2. Record the vault and source IDs (see Identity assertions).
3. Inspect the contract with `zotlit:template-schema` until the relevant root schema is loaded.
4. Inspect item-backed data with `zotlit:template-data` until each field the edit depends on is
   accounted for.
5. Read the active Template file, apply the edit, and save. The file parses without diagnostics.
6. Render in memory with `zotlit:template-render`. The rendered output matches the requested
   result; repeat from step 3 or 4 until it does.

## Identity assertions

Record both IDs once at the start of the loop. Assert both recorded IDs on every
`zotlit:template-data` and `zotlit:template-render` request thereafter.

Treat an identity mismatch as a hard stop. Run `zotlit:template-status` again, confirm the new
paths, and record the new IDs before continuing.

## Language policy

Liquid-first: author a Liquid Template by default.

Use Eta only when the required behavior needs JavaScript and Liquid cannot express it clearly.
Treat the current-device JavaScript Templates setting as the user's consent boundary. Ask the
user to enable it when Eta is necessary, and continue only after consent is active.
