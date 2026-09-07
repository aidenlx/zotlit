# An Item Snapshot carries only allow-listed fields

The Item Snapshot exporter spreads every Zotero field and custom field of the selected Item, its related Items, and each annotation's parent Item into the snapshot, and the personal-library `weblink` embeds the user's Zotero account username. The page then stored the whole snapshot in `localStorage` on the docs origin. Decided in the Local Bridge redaction review on map #835: the exporter emits only fields declared in the generated Zotero field schema plus the Item's custom fields, and a test diffs the exported shape against that declaration so a new field is redacted until someone declares it. The personal-library `weblink` is emitted as unavailable with a reason; the group-library form, which carries only the public group id, stays. Annotation text and comments, tag and collection names, attachment file names, the Extra field, and vault-relative link targets stay in, because a template renders them and the page runs on the user's own machine. Absolute paths, attachment contents, child-note bodies, annotation image bytes, and Zotero cache paths never leave, as before. A connected snapshot lives in `sessionStorage` only; drafts keep `localStorage`.

## Consequences

- Sample Items are regenerated from the allow-listed exporter; the snapshot test that fails on a contract bump also fails on an undeclared field.
- The `unavailable` list covers every root in the snapshot, including standalone annotation roots, and a citation style whose CSL carries no title falls back to its id rather than its file name.
- A template that prints `zt.weblink` previews it as unavailable for a personal library; the note written in Obsidian is unchanged.
