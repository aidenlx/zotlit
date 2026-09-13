# The settings hub is the Literature Note

After ADR 0031 the settings tab had eight page rows and no inline setting: the Profile bindings sat on a page named "Literature note profiles", the default Profile's Managed Frontmatter sat two pages deep under "Templates", and a "Templates" page survived beside a Profile whose document *is* the template (#878). A new user met the word Profile before their first note, and an upgrader who knew the "Note import" page had no page to find (#902, #905). Decided in the #835 settings grill, with the shared mental model of ADR 0025: the Literature Note is the primary authoring object, so its settings are the tab.

**The main page is the default Profile.** The default Profile's bindings render inline on the ZotLit settings page as ordinary settings — Literature note folder, Citation and references style, Template document, Properties — followed by an "Imported notes" group (Imported note folder, Use colored highlight syntax, Highlight mappings, Render annotations from template). No heading names the default Profile on the main page, and its shape never changes with the Profile count; "Default" is named only on the Literature note profiles page, as the first row of the list, where the comparison with other Profiles happens. The word Profile reaches a beginner once, as the name of that page row.

**The Templates page dissolves.** `cite`/`cite2` move to the Citations page; the template folder, the JavaScript Templates gate, auto-pair, and trim form a "Template engine" group on an "Advanced" page that replaces Maintenance. Zotero database, Library, and Live updates merge into one "Zotero" page.

**The settings tab edits no legacy setting.** Managed Frontmatter has one editor, the template document: the settings tab shows a "Properties" row that points at Customize, never a field list, and the eject carries the current `note.frontmatter-fields` into the ejected document so no field is lost. While the legacy template conversion is pending, every legacy surface — the field list, the `note`/`content`/`annotation`/`filename` slot rows — is hidden rather than shown read-only; the conversion reminder is the only trace. The web Template Workbench's own migration to this format is out of scope here. Settings row names stay stable across the move so Obsidian's own settings search still lands old names, and the docs settings reference carries a "Where settings moved" table; no in-app notice announces the move.

## Considered options

- **Keep subsystem pages and tidy them**: leaves "Templates" beside "Profiles", the exact ambiguity #878 names, and keeps every setting one click deep.
- **Profile list with Default as first row, edit each on a drill-down page**: shows the concept to everyone and contradicts ADR 0031's "the file is the editor".
- **Name the default Profile on the main page once a second Profile exists**: makes the page change shape under the user; the Profiles page already has the row format to explain inheritance.
- **A one-time "settings moved" reminder for upgraders**: dropped for simplicity; stable names plus search plus the docs table cover the same need.
- **A Properties list editor in settings while the default Profile is built-in**: two editors for one thing, a dual-mode row, and #903's read-only window; dropped for one extra Customize step.

## Consequences

- `apps/obsidian/src/setting-tab/` loses `templates.ts` as a page and `frontmatter.ts` with its field modal, gains the merged Zotero and Advanced pages; deep links resolve by row name and keep working, the Welcome quick-start link retargets to the Zotero page.
- `ProfileService.ejectDefault` builds the document from the current `note.frontmatter-fields`, not the built-in defaults; `note.frontmatter-fields` survives in the schema only as conversion and eject input.
- Message keys for moved rows keep their English text. New copy covers the Zotero and Advanced page names, the group headings, the Properties row, the Default row, the Profiles empty state, the per-Profile row summary, and the Highlight mappings suffix "Applies to all profiles." The `settings_frontmatter_*` field labels survive for the docs pages that still describe the fields until the template-docs rewrite.
- `apps/docs/content/docs/reference/settings.mdx` is rewritten to mirror the tab; every docs page that named a removed page fixes its `SettingsPath` reference; the conceptual rewrite of the template docs for the Profile document model is a separate issue.
- Issues #878, #902, and #905 close on this decision.
