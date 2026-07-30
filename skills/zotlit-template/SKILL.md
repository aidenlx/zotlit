---
name: zotlit-template
description: "Use when authoring or debugging ZotLit note, content, annotation, or filename templates through the Obsidian CLI Template Workbench."
---

# ZotLit Template Workbench

Use the Template Workbench to inspect template contracts and item data, make a surgical
Template edit, and validate the result with an in-memory render.

Keep Obsidian open for the full workbench session.

## CLI pointers

Before you start, use `obsidian help zotlit` as the source of truth for commands and flags.

Use `zotlit:template-guide` as the source of truth for workbench contracts and concrete
invocations.

For every structured response, test `ok`. When it is `false`, follow `diagnostic.hint`.

## Safety model

Treat workbench inspection and rendering as side-effect-free. Keep rendered output in memory.

The Template file edit is the only planned vault write. Read the active file first, then
preserve unrelated content.

Eta is full-privilege JavaScript. Rendering an Eta Template executes vault-provided code with
Obsidian's privileges.

## Workbench loop

1. Run `zotlit:template-status`.
2. Confirm the vault and Zotero source paths.
3. Record the vault and source IDs.
4. Inspect the contract with `zotlit:template-schema`.
5. Inspect item-backed data with `zotlit:template-data`.
6. Read and edit the active Template file.
7. Render in memory with `zotlit:template-render`.
8. Inspect the response, then repeat from contract or data inspection until the output matches
   the requested result.

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
