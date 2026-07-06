# PRD: 9.2-CSL — cite-contract widening + annotation citations

Status: done

Supersedes POST_ALPHA §1.4 "9.2-CSL" and the §3 annotation citation surfaces. The vocabulary-direction decision is recorded in ADR 0003 (cite templates use the zt item vocabulary, not raw CSL-JSON); resolved glossary terms (Citation, Citation Item, Locator, Embedded Item Data) live in the Obsidian plugin CONTEXT.md.

## Problem Statement

Citations rendered by ZotLit are citekey-only. When a Zotero note containing citations is imported, the page locator the author attached to each cite is silently discarded, so a citation that reads "(Nakamoto, p. 1)" in Zotero arrives in Obsidian as a bare `[@nakamoto2008]` — the pinpoint reference is lost and Pandoc can no longer resolve it. Cite templates receive nothing but the citekey, so users cannot build author-year or any data-driven citation format, even though the documentation promises full item data. Annotations know their page label, but neither the annotation template nor the annot view can produce a ready-to-paste page-pinned citation like `[@citekey, p. 62]`; users hand-type page numbers.

## Solution

Widen the cite-template contract in one pass so a citation carries both the cited item's data and the citation-scoped properties (locator, label, suppress-author, prefix, suffix), fed uniformly from both legs:

- **Zotero note import** — each cited ref resolves live-DB-first, falling back to the CSL-JSON snapshot embedded in the note (mapped into the zt vocabulary by a schema-driven reverse mapping), then to a greppable sentinel.
- **Database query** — citation-suggest inserts and the annotation surfaces build the same contract from live DB items.

The default cite templates are updated to emit Pandoc-parseable output — `[@smith2024, p. 62]`, `[@doe2020, chap. 3]`, `-@key` for suppressed authors — while remaining fully user-replaceable (citation syntax stays template-driven, never enforced). Annotation templates gain an opt-in `zt.citation` field rendering a page-pinned citation from the annotation's page label, and the annot view gains a "Copy citation" action producing the same string.

## User Stories

1. As a Pandoc user importing Zotero notes, I want a citation's page locator to survive import as `[@key, p. 62]`, so that citeproc resolves the pinpoint reference in my rendered document.
2. As a Pandoc user importing Zotero notes, I want non-page locators (chapter, section, paragraph…) rendered with their Pandoc abbreviations (`chap.`, `sec.`…), so that every locator kind round-trips correctly.
3. As a template author, I want cite templates to receive the cited item's full data (title, creators, date, container title…), so that I can build author-year textual citations like `Smith (2024)` or wiki-link formats.
4. As a template author, I want cite templates and note templates to share one camelCase field vocabulary, so that I never juggle two naming schemes for the same fields.
5. As a template author, I want citation-scoped properties (locator, label, suppress-author, prefix, suffix) exposed separately from the item, so that my template can distinguish what is cited from how it is cited.
6. As a template author, I want a display-ready locator abbreviation next to the raw label, so that my default-style template stays a one-liner.
7. As a template author with an existing citekey-only cite template, I want my template to keep rendering unchanged after the upgrade, so that the widening is non-breaking.
8. As a user citing items from another library, I want the embedded snapshot to supply both citekey and item data, so that cross-library cites render fully even though my local DB cannot resolve them.
9. As a user whose Zotero database is temporarily unavailable, I want note import to fall back to embedded snapshots for citation resolution, so that imports still produce useful citations.
10. As a user importing a note that cites an item with no citation key anywhere, I want a visible `KEY?` sentinel in the output, so that I can grep for unresolved cites and fix them.
11. As a user whose DB item has no assigned citation key but whose note snapshot carries one, I want the snapshot's key used with the live item data, so that the citation is both current and resolvable.
12. As a word-processor-citation user, I want suppress-author citations expressed as `-@key` by the default template, so that suppressed-author semantics survive into Pandoc syntax.
13. As a template author, I want prefix and suffix carried on the citation data, so that a custom template can render them even though the defaults do not.
14. As an annot-view user, I want a "Copy citation" context-menu action on an annotation that copies `[@citekey, p. N]` to my clipboard, so that I can paste a page-pinned citation into any note.
15. As an annot-view user whose item lacks a citation key, I want the copy action to tell me why nothing useful can be copied, so that I am not left with silent failure.
16. As a template author, I want a `zt.citation` field in the annotation template, so that drag-inserted annotations already carry a page-pinned citation.
17. As a user importing Zotero notes with annotation paragraphs rendered through the annotation template, I want the same `zt.citation` field available there, so that imported annotations carry the same citation my annot-view inserts do.
18. As a user who keeps the default annotation template, I want my rendered output unchanged after the upgrade, so that opting into annotation citations is my choice (a one-line template edit), not a forced behavior change.
19. As a citation-suggest user, I want inserted citations to keep working through the widened contract, so that the editor `@`-completion flow is unaffected.
20. As a maintainer, I want the CSL mapping tables generated from the Zotero schema rather than hand-written, so that schema updates propagate mechanically.
21. As a template author reading the documentation, I want the cite-template data reference to match what templates actually receive, so that I can trust the docs.
22. As a user importing a note whose citation markup is malformed, I want the original HTML preserved verbatim, so that no information is destroyed.

## Implementation Decisions

- **Contract shape** (settled during the grilling session; type shape encodes the decision):

  ```ts
  // zt.* for cite/cite2 (identical contract for both)
  zt.items;     // pure items, camelCase zt vocabulary
  zt.citations; // same order; citations[i].item === items[i]

  interface CitationTemplateItem {
    item: TemplateCiteItemData; // never null — stub with null fields when unresolved
    locator: string | null;     // e.g. "62"
    label: string | null;       // raw CSL locator label, e.g. "page"
    labelShort: string;         // Pandoc-style: "p.", "chap.", "sec.", … ("page"/absent → "p.")
    suppressAuthor: boolean;    // default false
    prefix: string | null;
    suffix: string | null;
  }
  ```

- **Item vocabulary** (ADR 0003): cite items use the camelCase zt vocabulary shared with note templates. The Citation Item / item split honors the CSL boundary — citation-scoped properties never live on the item.
- **Narrowed item type**: the cite item is a narrowed variant of the template item data (precedent: the filename and parent-item variants) carrying only fields both legs can supply; vault/DB context the embedded snapshot cannot express (tags, dateAdded/Modified, library identity, resolvers) is excluded. Contract types live in the db package alongside the existing template-item vocabulary.
- **CSL→zt reverse mapping**: a schema-driven `itemFromCSLJSON`-equivalent in the db package converts embedded CSL-JSON item data to the narrowed zt shape — text variables via the reverse field map (first valid candidate), CSL type → Zotero item type, CSL name variables → creators (role from the name variable), `issued` date-parts/literal → the ItemDate shape, `citation-key` → citationKey/citekey. The mapping tables are generated into the zotero-types package from the Zotero schema's `csl` section (its native orientation, CSL variable → Zotero field candidates, is what the mapper consumes).
- **Parse widening, refutation recorded**: the note-mark citation schema accepts `locator`, `label`, `suppress-author`, `prefix`, `suffix` per citation-item, permissively. POST_ALPHA's "re-add `properties` to CitationSchema" is refuted by upstream source: Zotero note citations never persist suppress-author and citation-level `properties` is always empty; where Zotero stores it (word-processor integration), it is per citation-item. Zotero notes won't produce suppress-author today; parsing it tolerates other producers. The embedded citation-items schema widens from citekey-only to full CSL-JSON item data.
- **Resolution per cited ref (import leg)**: item data = live DB item → mapped embedded snapshot → stub with null fields; citekey = item's own citation key → embedded snapshot key → `KEY?` sentinel; the final citekey is written onto the cite item so legs may mix. Templates never null-check the item. All-citekeys-null keeps the original HTML (unchanged behavior). Degraded DB resolves embedded-only, as today. The import DB leg fetches full items by key per citation, grouped by the cited library — no new query surface.
- **DB-query leg**: citation-suggest builds the same contract from the live item (no locator, props at defaults) through the existing render-citation seam; both producer chokepoints emit identical `{ items, citations }` payloads.
- **Default templates updated**: `cite` renders `[` + per-item `-@key` (suppress) + `, labelShort locator` (when present) joined by `; ` + `]`; `cite2` identical without brackets; both keep the citekey-presence filter, so the sentinel (`KEY?`) survives and composes (`-@KEY?`). Prefix/suffix are data-only in the defaults.
- **Annotation citation**: annotation template data gains `zt.citation` — the parent item rendered through the cite template with the annotation's page label as locator (label "page"), mirroring Zotero's own annotation citations. Lazily computed; null when the parent item has no citation key. Opt-in is template-driven: default annotation template unchanged, no new setting.
- **Annot-view "Copy citation"**: a context-menu action alongside copy-backlink/copy-text rendering the same citation string to the clipboard; shows a notice when the parent item has no citation key. Label localized via Paraglide.
- **Docs**: the template-v2 cite data reference is corrected to the real contract (it currently promises full item data the shipped code never delivered).

## Testing Decisions

Tests assert external behavior only: markdown/string output at rendering seams, parsed value shapes at schema seams — never internal call patterns or intermediate structures.

- **Note-import parser seam (primary, existing)** — note HTML in → markdown out. Covers: locator/labelShort rendering, DB-first/embedded/stub merge, citekey mixing across legs, sentinel output, cross-library cites, degraded-DB fallback, malformed-citation passthrough, and `zt.citation` on subsumed annotation paragraphs. Prior art: the existing citation-resolution and annotation-template-mode test groups with fixtures in the same file.
- **Note-feature operations seam (existing)** — the DB-query leg: widened render-citation payload for citation-suggest and the annotation citation/copy rendering, with DB queries mocked as in the existing operations tests.
- **Note-mark schema seam (existing)** — widened per-item citation props and full embedded item-data acceptance, including permissive handling of unknown keys. Prior art: existing note-mark parse tests.
- **CSL→zt mapper seam (new)** — unit tests for the reverse mapper in the db package following the existing `zt-*` lib test pattern: text/type/name/date mappings against generated tables, alias canonicalization, literal-date and institutional-creator edge cases.
- **Templates-package seam (new)** — the updated default `cite`/`cite2` files rendered through the template engine with contract-shaped data: locator + labelShort output, suppress prefix, sentinel filtering, multi-item joining. Prior art: the engine and frontmatter tests in the templates package.

## Out of Scope

- Any suppress-author **producer** UI (no toggle in citation-suggest or annot view) — the contract is ready, no surface sets it.
- Prefix/suffix rendering in the default templates (data-only).
- Better Notes compatibility (POST_ALPHA 9.4) and annotation merging.
- The v1 template syntax compat layer.
- Editing POST_ALPHA itself; this PRD and ADR 0003 are the record.

## Further Notes

- Upstream ground truth was verified against the local Zotero source checkout: note citations carry `uris`, optional `itemData`, `locator`, `label`, `prefix`, `suffix` per citation-item with `properties` always empty; Zotero's annotation citations use the page label as locator; `itemToCSLJSON`/`itemFromCSLJSON` are schema-driven, which is why the mapping tables are generated rather than hand-written.
- Citation syntax remains template-driven throughout — Pandoc `[@key, p. N]` is the default output, not an enforced format.
- Glossary: Citation, Citation Item, Locator, and Embedded Item Data are defined in the Obsidian plugin CONTEXT.md; the db CONTEXT.md's Citation Key entry governs citekey naming.
