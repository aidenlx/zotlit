# The Data Explorer lists fields by section with no view modes

The Data Explorer showed one of two views, Simple or All fields, chosen by a
segmented control above the list. The views shared every mechanism — search,
tree, row actions, menu — and differed only in which fields they listed, which
words named them, and how dense their rows were. The control took a 33 px
row in a 340 px sidebar, the two names told a researcher nothing about the
difference, and three always-visible icons per row put about 120 icons on
screen in All fields.

Decided in the Data Explorer grilling on this branch (2026-09-10): the
Explorer shows one tree grouped into sections. Common fields lead in the
fixed order typing completion already uses; every other field has exactly one
home in a category a researcher recognizes — Reference, Identifiers, Content
and files, Organization, Links, Zotero record for an Item; Annotation, Source,
Organization, Links, Zotero record for an Annotation. A field the taxonomy
does not name joins the first section, so an item-type field or a new contract
key is never lost. Every top-level row shows a human name: ZotLit's own label
where it has one, otherwise Zotero's field label from the bundled schema in
the reader's locale, in sentence case for English. The raw path stays in the
tooltip and in Copy path, and search matches name, key, and value.

Rows share one density. Each row carries two actions, Insert and a menu,
revealed on hover or focus and always visible on touch; Copy value and the
snippets live in the menu, which a right click also opens. A section's closed
state replaces the view mode in persisted view state. In Obsidian the pane
menu and a view action collapse or expand every section, and the in-content
heading appears only in a sidebar, where the native title is hidden.

The note-name root hides `notePath` and `noteLink`, which the contract keeps
as stubs that are empty for every item.

## Considered options

- **Keep two views, move the switch into native chrome**: removes the pill
  but keeps two vocabularies for one list and an unlabeled icon toggle in
  the sidebar.
- **Two sections only, Common and the rest**: no taxonomy to maintain, but
  thirty raw keys in one alphabetical block under the common rows.
- **Zotero's item pane sections as the taxonomy**: familiar names, but six of
  its ten sections hold one row each in a 340 px sidebar.
- **Raw keys outside the common fields**: keeps the key an author types
  visible, and mixes "Published in" with `containerTitle` in one category.

## Consequences

- `@zotlit/zotero-types` exports `field-labels`, generated from the schema for
  the bundled locales, so a Zotero field needs no ZotLit message.
- `@zotlit/workbench/ui` owns the taxonomy in `explorer-sections.ts`; a new
  contract key lands in the first section until it is placed.
- The Obsidian view persists `collapsedSections` where it persisted `variant`;
  a saved `variant` is ignored.
- ADR 0044's projection table names Simple/All; this decision replaces that
  field with the closed-section set.
