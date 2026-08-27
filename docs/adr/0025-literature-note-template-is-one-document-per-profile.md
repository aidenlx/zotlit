# The Literature Note Template is one document per Profile

ZotLit v2.1 stored a Literature Note's template as two files — `note` (whole body on create and overwrite) and `content` (the Managed Region body on update) — plus a `filename` slot file and a settings-held frontmatter field list. An earlier edition of this ADR unified the pair at the presentation layer only, because zero migration was a hard constraint (aidenlx/zotlit#839). Adopting Literature Note Profiles lifted that constraint: each Profile carries its own template set, a per-Profile file pair would multiply the fragment files, and a one-time format migration was accepted (aidenlx/zotlit#841 grilling). We decided the Literature Note Template becomes **one template document per Literature Note Profile**: manifest frontmatter (identity and configuration defaults, including the filename rule) plus a note body containing the Managed Block.

## The Managed Block

`{% managed %} … {% endmanaged %}`, supported in both Liquid and Eta. It is a **self-contained sub-template**: it renders in isolation, and variables assigned outside the block are not visible inside it, so an update-time render is identical to a create-time render — the property that makes managed updates correct. On create it renders in place within the body; on update it alone re-renders to refill the note's `%%zt-managed%%` Managed Region. The note-side format does not change. Zero blocks is a permitted degenerate form — a static body whose updates touch frontmatter only, reported by a named notice. Two or more blocks fail validation: the render refuses with a diagnostic that names the duplicate.

## Shape rulings

- The body may `{% render %}` shared partials by name. Partials are vault-global — one flat namespace, no per-Profile partial resolution — and a Profile bundles its transitive partials when distributed. The distribution unit is the document itself: envelope fields from the Template Pack draft (aidenlx/zotlit#842) live in the manifest, and a partial-free Profile shares as one copy-pasteable file.
- `cite` / `cite2` stay vault-global template files outside the Profile. The `filename` slot retires into the manifest.
- One rendering language per document; Eta stays behind the JavaScript Templates gate.
- The old format keeps working as the legacy default Profile until a prompted one-shot converter migrates it. The converter's output must render byte-identically for the same item, verified in memory by the Workbench before any write; converted files go to Obsidian's recoverable trash.

## Considered options

- **Presentation-only unification over the two-file pair** (this ADR's earlier edition): correct under the zero-migration constraint, but under Profiles it multiplies fragment files per Profile and leaves the frontmatter field list outside the shareable artifact.
- **Per-Profile folders of the existing slot files**: answers the fragment complaint by grouping instead of merging, and keeps two authoring objects per Profile forever.

## Consequences

- `packages/templates/` and the note-feature pipeline reopen for this work, reversing the earlier edition's off-limits ruling; aidenlx/zotlit#862 and aidenlx/zotlit#863 re-scope against the document format.
- The frontmatter field spec moves into the document's manifest. Its expression design (engine evaluation, no private YAML control-flow syntax; must solve aidenlx/zotlit#641 and aidenlx/zotlit#645) is a separate design ticket and gates the format spec's ratification.
- Note-side coupling stays minimal: `zotero-key`, the Profile stamp, and the `%%zt-managed%%` markers are the whole contract between a note and this format.
