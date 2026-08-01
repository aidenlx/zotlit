# Cite templates use the zt item vocabulary, not raw CSL-JSON

POST_ALPHA §1.4 recommended CSL-JSON field names for the cite-template vocabulary, which implies normalizing the DB leg *to* CSL (`itemToCSLJSON`-equivalent). We decided the opposite: cite-template items use the same camelCase zt item vocabulary as note templates (`containerTitle`, `creators`, `date`, …), so template authors learn one vocabulary, and the *embedded* leg (CSL-JSON snapshots in `data-citation-items`) is normalized into zt via a schema-driven reverse mapping (`itemFromCSLJSON`-equivalent, tables generated from the Zotero schema's `csl` section). Citation-scoped properties (locator, label, suppress-author, prefix, suffix) never live on the item; they ride on Citation Items in `zt.citations`, with `zt.items` kept as the derived pure-item array.

## Context worth remembering

- Upstream ground truth (Zotero `editorInstance.js` / note-editor): note citations **never** persist suppress-author, and `citation.properties` is always `{}`. Where Zotero does store suppress-author (word-processor integration), it is per citation-item as `"suppress-author"`. POST_ALPHA's "re-add `properties` to CitationSchema" is therefore refuted — the parser instead accepts the full per-item prop set permissively.
- Zotero's own `itemToCSLJSON`/`itemFromCSLJSON` are schema-driven from `resource/schema/global/schema.json` (`csl.types`, `csl.fields`, `csl.names`) — the same schema `packages/zotero-types` generates from, which is why the reverse mapping is generated, not hand-written.

## Considered options

- **Raw CSL-JSON item data in cite templates** (hyphenated keys, zero mapping on the embedded leg, `itemToCSLJSON` for the DB leg): rejected — splits the user-facing template vocabulary in two (`zt.containerTitle` in note.eta vs `c["container-title"]` in cite.eta) and hyphenated keys are hostile in Eta.
- **Citation-key-only embedded leg** (no reverse mapping): rejected — cross-library and degraded-DB cites would silently render blanks in data-driven cite templates.
