---
name: zotlit-template
description: "Create, edit, diagnose, and verify ZotLit templates and managed frontmatter in an Obsidian vault. Use whenever a user wants to change template output, configure managed frontmatter field templates, or troubleshoot, including when they describe only the desired result."
---

# ZotLit Template Workbench

## Start

Follow these steps in order before editing any template or frontmatter configuration.

1. `obsidian help zotlit` — commands reject unrecognized parameters; never guess a name.
2. `obsidian zotlit:template-status` — pass `expect-source=<identity.source.id>` to every later command.
3. `obsidian zotlit:template-guide`
4. `obsidian zotlit:template-guide topic=liquid`

This skill is written against Template Workbench CLI Contract version 2 — the `contractVersion` every workbench answer carries. When an answer reports another number, run `zotlit:template-guide` again and follow the live guide over this skill.

## Inspect only what the edit needs

Complete **Start** steps 1–3 before running `zotlit:template-data` or `zotlit:template-schema`.

Data output can be very large. Pipe directly to `jq` and select only the fields,
definitions, or array entries needed. 

Data lives under `.zt` — use `.zt.<field>`,
not `.<field>`. 

Start with `zotlit:template-data`; use `zotlit:template-schema` only when a
required field or nested shape is unclear. Quote keys such as `."$defs"` that
start with `$`. Before the first `zotlit:template-schema` call, run `obsidian zotlit:template-guide topic=data`.

Save the downloaded schema file wherever temporary files belong on the
current system, and reuse it for every later question about the same schema.

## Choose the language

Prefer Liquid. Use Eta only when the required behavior is absent from the supported Liquid tags and filters. Ask the user to enable JavaScript Templates in ZotLit settings before using Eta.

## Tone

**Guide** the user: use plain language, explain each step before running it, and name what a command does in everyday terms ("let me check which Zotero library is connected" instead of "running template-status"). When a concept matters (indexed key, template root, Liquid vs Eta), introduce it in one sentence the first time — then use the short name freely.

## Discovery

When the request already names a concrete edit — a field to add, a layout to change, a bug to fix — skip straight to Start.

Otherwise, **grill** the user to reach a concrete goal. Many users cannot describe what they want in template terms — guide them there.

1. Ask what they want their notes to look like or what they want to change. One open question.
2. If the answer is vague, consult `obsidian zotlit:template-guide` and offer two or three concrete possibilities drawn from what the current template roots support (e.g. "Would you like to include annotation highlights? Add Zotero tags? Change how the citation key appears?").
3. Once the goal is clear, summarize it back in one or two sentences and confirm with the user before proceeding.

Ask questions one at a time. If a fact can be found via the CLI, look it up rather than asking. The decisions are the user's — put each one to them and wait.

## Target one vault

Put `vault=<vault-name>` first when the target is ambiguous:

```sh
obsidian vault=MyVault zotlit:template-status
```

Without `vault=`, the vault containing the working directory handles the command. Outside a vault, the most recently focused vault handles it. Confirm `identity.vault` once, then keep the same prefix.

`obsidian vault` shows the active vault. `obsidian vaults` lists all known vaults.
