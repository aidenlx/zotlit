---
name: zotlit-pandoc
description: "Set up, refresh, run, and diagnose ZotLit's Native Pandoc Workflow with a user-installed Pandoc CLI. Use when a user wants native Pandoc to convert an Obsidian Markdown file through the ZotLit Pandoc Integration Pair. Requests for ZotLit's built-in Obsidian export belong to its built-in export command."
---

# ZotLit Native Pandoc Workflow

## Start from the installed contract

Complete these steps before changing files, running Pandoc, or calling the resolver.

1. Run `obsidian-cli help zotlit` and use only the commands it reports.
2. Target the vault that owns the input file. Put `vault=<vault-name>` before the command when the working directory does not select it unambiguously.
3. Run `obsidian-cli zotlit:pandoc-guide` against that vault. Treat this live guide as the source of truth for ZotLit commands, file names, compatibility floors, resolver responses, and error codes.

Read the guide again after a ZotLit update or when a saved integration pair might be stale.

This skill is written against Pandoc CLI Contract version 2 — the `contractVersion` the integration-files answer carries. When that answer reports another number, run `zotlit:pandoc-guide` again and follow the live guide over this skill.

## Select the workflow

Match the user's goal to one path:

- **First setup**: ask the user to select a user-owned workflow folder. Suggest a project-local folder when they have no preference.
- **Refresh**: reuse the workflow folder the user supplies. Limit replacement to that authorized pair.
- **Export**: use the existing workflow folder and a user-supplied CSL-JSON bibliography.
- **Diagnosis**: reproduce or inspect the failed native run, then use the resolver only when its result can identify the fault.

The built-in Obsidian export command owns requests for export through ZotLit's managed Pandoc engine and user interface.

## Set up or refresh the pair

1. Retrieve the installed pair with the command named in the live guide.
2. Parse its single JSON response and record the reported plugin version in
   the final report.
3. Compare both destination files byte for byte.
4. When either file differs, stage both returned files and replace both
   destination files as one pair. Preserve the prior pair until both staged
   files are ready.
5. Keep user Pandoc options on the command line or in a separate user-owned defaults file.

For a first setup, explain the selected folder and replacement plan before writing. For a refresh, leave every copy outside the supplied workflow folder unchanged.

## Run native Pandoc

Reuse a CSL-JSON bibliography the user supplies. Validate that it is readable
JSON before starting Pandoc. When the user needs a bibliography, recommend
Better BibTeX CSL-JSON auto-export for automatic refresh and accept a manual
Zotero CSL JSON export. Treat the bibliography as user-owned input: ZotLit
supplies Citation Keys to Pandoc and leaves bibliography creation to Zotero.

Leave the citation style with its owner. The live guide states which style input
ZotLit resolves and which one stays Pandoc's; follow it. Ask the user which style
they mean before a document carries more than one style input.

Use the minimal `--defaults` invocation from the live guide. Quote every
user-selected path and keep `--fail-if-warnings`, so a Citation Key missing
from the bibliography stops the export. Write to a unique staged output beside
the requested output. In a normal export, let the Lua filter call
`zotlit:resolve`.

Publish the requested output only after Pandoc exits successfully and the
staged file is non-empty. Confirm replacement when the requested output already
exists. A failed run leaves the requested output unchanged and removes its
staged file.

## Diagnose a failed run

1. Read the native Pandoc error and confirm which input, workflow folder, bibliography, and output path were used.
2. Confirm that the saved pair matches the current response from the installed plugin.
3. Call `zotlit:resolve` directly only after the normal run fails, with the
   absolute input path and the vault targeting established in **Start from the
   installed contract**.
4. Interpret the response through the error definitions and recovery guidance in the live guide.
5. Compare every resolved Citation Key with the `id` values in the supplied
   bibliography before retrying the normal Pandoc run.

When resolved keys are absent from the bibliography, name every missing key
and ask the user for a refreshed Better BibTeX CSL-JSON auto-export or a new
manual Zotero CSL JSON export. Preserve the supplied bibliography until the
user authorizes a replacement.

When the resolver reports a note or citation-intent error, name the source
link and the matching guide error. Ask the user to correct that source note;
retry only after the input change is authorized.
