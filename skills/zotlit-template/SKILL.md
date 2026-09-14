---
name: zotlit-template
description: "Create, edit, diagnose, and verify ZotLit Template Documents in an Obsidian vault. Use for Profile layouts, Managed Frontmatter, Citation Variants, Shared Partials, and template errors, including requests that describe only the desired output."
---

# ZotLit Template Workbench

## Inspect → edit → check

1. Read `obsidian help zotlit` and `obsidian zotlit:template-guide`. Keep one explicit `vault=<name>` prefix on calls. Use `template-inspect` to identify the selected document and confirm the vault and Zotero source. Use the returned source identity on later calls as the live help describes.
2. Read the selected source and its diagnostics. Preserve unrelated source and Profile identity. If the edit needs an unfamiliar data field, use focused `template-data` discovery; otherwise continue with the source already available.
3. Edit the Template Document directly with file tools. For a trial or an uninstalled document, write a complete scratch file and check that draft. Keep scratch files outside the installed template folder.
4. Run `template-check` against an Item the source's own `match` rule selects, or against an existing Literature Note. Select and read the outputs affected by the request. Compare actual output with the requested result and, for an update, with the existing note's user text. Follow failed responses through their diagnostic hints, then edit and check again.
5. Complete only when the checked source revision is current, all required checks pass, and the inspected output matches the request. After saving a previously checked draft to its installed path, check the saved document again. A draft-only request completes with the scratch file still uninstalled. Prove preservation with bytes: hash an unrelated file before and after, or compare it against the revision the check reports. Report the changed file and the output you verified; state any unverified requirement.

This skill is written against Template Workbench CLI Contract version 7. Compare the first answer's `contractVersion`; if it differs, read the live guide again and follow that contract.

## Read the relevant guide topic

Use `template-guide topic=<name>` when the request reaches one of these branches:

- `inspect`: target selection, invalid source, or external file edits and freshness.
- `check`: scratch drafts, output selection, or detailed failed-attempt evidence.
- `data`: unfamiliar fields and nested data shapes.
- `frontmatter`: JSON-e, Spread Entries, or YAML value rules.
- `profiles`: create/update behavior and preservation.
- `citations`: both Citation Variants.
- `partials`: caller context and checking a Shared Partial with its Profile.
- `troubleshooting`: YAML repair or recovery after a failed check.
- `liquid`: supported template syntax; `eta`: behavior that requires JavaScript Templates.

Prefer Liquid for body templates. Use Eta when the requested behavior needs it, with the user's JavaScript Templates setting enabled through ZotLit settings.

Explain findings in plain language. Ask for a missing user choice when it changes the intended result; obtain environment and command facts from inspection and help.
