---
name: zotlit-template
description: "Use when the user wants to create, edit, or fix a ZotLit template — including when they mention templates, citations, annotations, or note formatting in their vault."
---

# ZotLit Template Workbench

## CLI pointers

Use `obsidian-cli help zotlit` as the source of truth for commands and flags.

Use `obsidian-cli zotlit:template-guide` as the source of truth for workbench contracts and concrete
invocations.

For every structured response, test `ok`. When it is `false`, follow `diagnostic.hint`.

## Vault targeting

Obsidian routes each CLI invocation to exactly one vault before ZotLit runs; a command never
reaches more than one vault, even when several vaults have ZotLit installed.

Select the vault with `vault=<vault-name>` as the **first** token:
`obsidian-cli vault=MyVault zotlit:template-status`. Without `vault=`, the vault whose folder
contains the working directory handles the command; when the working directory is outside
every vault, the most recently focused vault window handles it.

When more than one vault is open, run commands from inside the vault folder or pass `vault=`.
Confirm the target once with `obsidian-cli zotlit:template-status` — `identity.vault` echoes
the answering vault's name and absolute path — then keep the same `vault=` prefix for the
whole loop.

`docs/obsidian-cli-vault-routing.md` records the full routing behavior.

## Safety model

Keep rendered output in memory.

The Template file edit is the only planned vault write. Read the active file first, then
preserve unrelated content.

Eta is full-privilege JavaScript. Rendering an Eta Template executes vault-provided code with
Obsidian's privileges.

## Tone

The user may be new to ZotLit, templates, or programming. **Guide** them: use plain language,
explain each step before running it, and name what a command does in everyday terms
("let me check which Zotero library is connected" instead of "running template-status").
When a concept matters (indexed key, template root, Liquid vs Eta), introduce it in one sentence
the first time — then use the short name freely.

## Discovery

Before acting, **grill** the user to understand the goal. Many users cannot describe what they
want in template terms — guide them there.

1. Ask what they want their notes to look like or what they want to change. One open question.
2. If the answer is vague, consult `obsidian-cli zotlit:template-guide` and offer two or three
   concrete possibilities drawn from what the current template roots support (e.g. "Would you
   like to include annotation highlights? Add Zotero tags? Change how the citation key appears?").
3. Once the goal is clear, summarize it back in one or two sentences and ask "Does that sound
   right?" Proceed only after the user confirms.

## Steps

1. Collect at least one **indexed key** from the user if not already provided. Point them to the
   [Explore template data](https://zotlit.aidenlx.site/docs/how-to/explore-template-data#indexed-key)
   guide for copy instructions.
2. Run `obsidian-cli zotlit:template-status`. Confirm the vault and Zotero source paths.
3. Record the source ID (see Identity assertions).
4. **Drill** the contract with `obsidian-cli zotlit:template-schema` (see Schema drilling).
5. Inspect item-backed data with `obsidian-cli zotlit:template-data` until each field the edit depends on is
   accounted for.
6. Read the active Template body with `obsidian-cli zotlit:template-source` — it returns the winning
   body even when only the built-in default exists. Apply the edit and save it to the active file,
   or to `editablePath` when no vault file exists yet. The file parses without diagnostics.
7. Render in memory with `obsidian-cli zotlit:template-render`; test `ok` and read `warnings`.
   The rendered output matches the requested result; repeat from step 4 or 5 until it does.

When a render is empty or wrong, shrink the Template to a minimal probe that tests one variable or
one construct, read `warnings` in the render envelope, and test one hypothesis at a time. Restore
the full Template after the probe renders correctly.

## Data root

All template data lives under the single root variable `zt`: write `{{ zt.title }}`,
`{{ zt.annotations }}`. The schema for a root describes the shape of `zt`.

## Schema drilling

The schema output is large (up to ~110 KB). Load it in layers with `jq`, starting wide and
narrowing to the fields the edit touches.

In jq, quote keys that start with `$`: write `."$defs"`. Pipe the CLI straight into `jq`
on each drill — the command is local and fast.

1. **Map** — read the schema's own description, the `$defs` names, and the root-ref properties:
   `obsidian-cli zotlit:template-schema root=note | jq '{ title, description, defs: (."$defs" | keys), props: (."$defs"[."$ref" | ltrimstr("#/$defs/")].properties | keys) }'`
2. **Zoom** — pull one `$def` or a slice of root properties:
   `obsidian-cli zotlit:template-schema root=note | jq '."$defs".TemplateAnnotation'`
   `obsidian-cli zotlit:template-schema root=note | jq '."$defs".NoteTemplateContext.properties | {key, itemType, title}'`
3. **Done** — every field the edit depends on is accounted for in the loaded slices.

## Identity assertions

Record the Zotero source ID once at the start of the loop. Assert it on every
`obsidian-cli zotlit:template-data` and `obsidian-cli zotlit:template-render` request
thereafter, using the assertion flag `obsidian-cli help zotlit` lists.

Treat an identity mismatch as a hard stop. Run `obsidian-cli zotlit:template-status` again, confirm the new
source path, and record the new ID before continuing.

## Language policy

Liquid-first: author a Liquid Template by default.

Use Eta only when the required behavior needs JavaScript and Liquid cannot express it clearly.
Treat the current-device JavaScript Templates setting as the user's consent boundary. Ask the
user to enable it when Eta is necessary, and continue only after consent is active.

## Reference material

- [ZotLit Template reference](https://zotlit.aidenlx.site/docs/reference/templates)
