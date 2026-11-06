# Compact snapshot of the docs

An abstract, compressed snapshot of the user docs under
`apps/docs/content/docs/`, kept as the input for the next docs plan. It is not
site content. A writer reads the compact file for a topic instead of the page
prose. Each compact file restates every fact, label, anchor, link, image, and
code block of its pages as data, with `VERIFY:` on anything only the running
app can confirm. Reference pages and the generated template-data page are
excluded on purpose.

The pages themselves stay in place on this branch; for a verbatim detail, read
the page.

History:

- Compacted 2026-10-20: 55 pages, 8,664 source lines → 1,778 lines.
- Refreshed 2026-10-26 (#1677) for #1626, #1679, #1687, #1696, #1712, #1721
  and #1722.
- Synced 2026-11-06 with `next` at 06bb1f5c8 (after ZotLit 2.2.1): the 30
  pages that changed in 2.2.0 and 2.2.1. See
  [What changed in 2.2.0 and 2.2.1](#what-changed-in-220-and-221).

Facts that a release changed carry a tag, so a writer can grep them like
`VERIFY:`: `CHANGED (<release or #n>)` (the page says this now),
`NEW (<release or #n>)` (new behavior), `STALE on next` (the page still says
the old thing; the tagged fact is the code's truth), `CONTRADICTION` (docs and
code disagree), `HIDDEN, DO NOT TEACH` and `NOT TAUGHT IN USER DOCS`. Where
several changes touched one fact, the latest state wins.

## What changed in 2.2.0 and 2.2.1

Synced 2026-11-06. Each fact carries its tag in the compact file.

- **One Update notes command (#1911, b54ce03e9).** A dialog updates the active
  literature note or every existing one; "create notes" is off by default, so a
  template change reaches existing notes only. The single-note commands stay
  for shortcuts; "Create or update all literature notes" is the batch that
  creates. Pages that still name only "Update note" are tagged. Facts in A
  (first-note, fix-stale-data), B (keep-notes-updated, create-and-open-notes),
  D and E.
- **Annotation Citations and the popover (#1896, #1898).** "Show annotation
  links as citations" (`citation.render-annotation-citations`, default off)
  renders an annotation link as its item's citation, page as locator, in the
  note's numbering. Every annotation popover shows the item's reference. Facts
  in B and C.
- **Show in Library (#1877).** Reveals and flashes a paper in the Library View
  from the quick switcher, literature note commands and menus, References,
  Cited by, citation popovers, graph nodes, and `zt.librarylink`. Facts in B
  and C.
- **Library View layout (#1883).** Tree toggle beside the search box and a
  resizable tree; the Reading Card is a full-width bottom panel toggled by a
  button or `Space`. Facts in A (first-note) and B.
- **Welcome checklist (#1880).** An optional fourth step detects ZotLit
  Companion and marks it installed. Facts in A and B (use-library-view still
  names three steps: STALE).
- **Query View Filter (#1909, #1916).** Every Zotero field is offered, found
  by English or Chinese search words; text rows ignore case (`icontains`);
  whole date fields; the expression editor colors and completes. Facts in D.
- **Template work.** Workbench tabs link to docs pages (#1936; those anchors
  must stay). Each 2.1 template conversion failure gives a way out, with a new
  "Properties that need a fix" section (#1906). The customize-template
  tutorial now inserts an annotation from the annotation sidebar. Facts in D
  and E.
- **Install.** Obsidian 1.14.5 is the minimum. The install-skill page covers
  four agent skills (`zotlit-template`, `zotlit-query`, `zotlit-citations`,
  `zotlit-pandoc`). Facts in A.
- **Smaller.** The citation graph stops with a notice in two cases, not three;
  the built-in export adds a References heading and native Pandoc export does
  not; re-importing a Zotero note warns that local edits are lost
  ("Overwrite imported note"). Facts in B and C.

## What changed in the 2026-10-26 refresh (#1677)

- **The default literature note body is written once (#1687).** The built-in
  Default profile has no managed block and no child-note list. Update note
  refreshes properties only; the Annotations query block reads Zotero live.
  Notes with old `%%zt-managed%%` markers keep working; deleting the two
  marker lines stops management. A customized or duplicated Default document
  has no managed block either. Facts in A (first-note, fix-stale-data), B
  (managed region, keep-notes-updated), D and E.
- **Child notes import only on request (#1687).** Rendering `noteLink` never
  imports: it links the imported file, or else a `zotero://` link that opens
  the note in Zotero. Facts in B (import-zotero-notes) and E (migrate v1 Eta).
- **Durable annotation links (#1626, final state #1721).** ZotLit writes
  `zotero://open/library/items/<attachmentKey>?annotation=<key>&page=<label>`
  for every annotation (`zt.backlink`); annotation `fileLink` / `file_link`
  is deprecated. Hover always shows the Annotation Popover. Click opens the
  ZotLit reader while Reader > "Open annotation links in ZotLit reader"
  (`reader.open-annotation-links`, default on) and "Open PDF file links in
  Obsidian" are on; otherwise Zotero opens it. New default annotation template
  with the page label linked to `zt.backlink` and `zt.citation` after the
  quote. Facts in B (open-pdf, annotation view), C, D (tutorial), E.
- **Citations settings (#1626 → #1696 → #1721 → #1722).** #1626 added
  "Zotero annotation links" and "Open annotation links in Obsidian" on the
  Citations page; #1721 removed both. #1696 added "Annotation citations"
  (default on); #1721 removed it; #1722 restored it, default OFF. Final:
  Citations > Citation sources has Pandoc citations (on), Wikilink citations
  (off), Annotation citations (off). While it is on, an empty-text
  `[](zotero://…)` link counts as a citation of its item in the references
  sidebar and in-text features, never in export or the graph view. Settings
  schema v10 → v11 migration drops `citation.annotation-links` and moves a
  stored `citation.open-annotation-links` value to
  `reader.open-annotation-links`.
- **Nested citations in export (#1712, ADR 0081).** A citation inside another
  citation's prefix or suffix exports as its written text and is cited through
  `nocite`. No user doc on next; the source is the ADR. Facts in C.

## Hidden or not taught (record only)

- `[>` Annotation Suggester and its "Annotation trigger" setting: out of 2.2.0
  (#1678), built only with `ANNOTATION_SUGGESTER_ENABLED=true` (#1679). Its
  messages remain in `messages/en.json`.
- Annotation uses (#1696): the Citation Index records every annotation link;
  the only surface is the CLI command
  `obsidian zotlit:annotation-uses key=<annotation-key>`. No UI.
- The Citation Index parses in its own worker (#1696): performance only.

## Which file covers which pages

| File | Pages |
| --- | --- |
| `A-setup-and-onboarding.md` | intro, install ×3, credits, first-note, keep-in-sync, live updates, security prompt (+partial), connection concept, sync-across-devices, fix-stale-data, update-installer, debug logs |
| `B-read-and-notes.md` | Library View, open PDF, edit PDF annotations, annotation view, create notes, managed region, excerpt images, keep notes updated, import Zotero notes |
| `C-cite-export-reading-status.md` | insert citations, citekey links, review/copy/troubleshoot references, citation graph, export ×2, both citation tutorials, track reading status |
| `D-queries-and-templates.md` | use-query-files, query-zotero-library, both query concepts, customize-a-template, use-different-templates, frontmatter properties, how-templates-work, customize-template tutorial |
| `E-advanced-templates-migrations-hubs.md` | profile as markdown, enable JS templates, explore template data, profiles, Workbench view, Workbench CLI, JS templates concept, five migrate pages, three hub index pages |

## Cross-group findings a writer must know

**Anchors that other pages or the plugin link to. Keep them or carry them.**
- In-app: `how-to/explore-template-data#indexed-key` (heading "Copy a Zotero key"; a different topic from the rest of that page).
- Cross-page explicit: `concepts#reading-the-zotero-database`, `use-library-view#not-found/#recent/#rows/#show-in-library`, `open-pdf-in-obsidian#recently-read`, `create-and-open-notes#quick-switcher/#bulk-profiles`, `excerpt-images#saved-snapshots/#import-outcomes`, `insert-citations#citation-keys/#citation-text/#ambiguous-key`, `how-citekey-links-work#ambiguous-key`, `review-copy-troubleshoot-references#copy-references/#requirements`, `how-zotlit-query-works#steps`, the `track-reading-status` set (`#add-column #edit #create #in-note #sort #filter #bases`), `keep-zotero-and-obsidian-in-sync#when/#install/#zotero-actions/#live-updates`, `collect-debug-logs#template-error-report/#obsidian-debug-info/#template-data`, `migrate-from-v1#refresh-v1-notes`.
- Inbound links that rely on AUTO-slugged headings with no explicit anchor (fragile): on `edit-pdf-annotations`: `#edit-the-quoted-text #delete-an-annotation #before-you-edit #add-or-edit-a-comment #undo-and-redo-a-change`. Give them explicit anchors when rewriting.

**Content written more than once (pick one home, link from the rest).**
- Zotero read mode / WAL explanation: 4 pages (A group + fix-stale-data).
- Live-updates summary: 4 pages. Per-device path resolution: 2. "Edit > Settings / Zotero > Settings" path: 4.
- Bulk Zotero-driven note update: 3 places (create-and-open-notes, keep-notes-updated, import-zotero-notes).
- Update / overwrite / v1-note recovery: managed-region concept + keep-notes-updated, worded differently.
- Excerpt-image fallback behaviour: 4 pages. Locked-annotation and multi-select text: 2.
- Built-in export modal walkthrough: 3 places. Native Pandoc route: 2 places. Built-in route is the shorter default candidate.
- Ambiguous citation key: 3 places.
- Query embeds / `this.item` / where changes save: how-to + concept. Exact names, `tags[].name`, Error Values, `Query thesis` examples: how-to + concept.
- Partials and `zt.variant`: customize-a-template + how-templates-work.
- JS template gate, per-device scope, risk: 3 pages.

**Contradictions to resolve in the walk.**
- Bug-report link: `discussions/new?category=bug-reports` vs `discussions/categories/bug-reports`.
- Default server host `127.0.0.1` vs default Notify URL `localhost`.
- Companion "can push live events" vs "does not run a background server".
- Tutorials disagree on whether Wikilink citations must be on.
- `write-and-export-cited-note` prose uses key `doe2024`; screenshots show Rougier 2014.
- RESOLVED: `%%zt-managed%%` (markers in the note) and `{% managed %}` (block in the profile document) are both correct.
- RESOLVED in 2.2.1 (82c0ff06c): the customize-template tutorial now inserts an annotation, so this no longer holds. Was: NEW (#1677) `tutorial/customize-template` on next: "Update this note" runs an ordinary update, so a current default note keeps its body, and its query-block cards never use the annotation template. The "annotations now use quote callouts" result and its screenshots no longer hold (D).
- NEW (#1677) `collect-debug-logs` on next says imported child notes give `$inert` placeholders; the Explorer code now gives a real link (A).
- NEW (#1677) pages #1687 did not edit still assume Update re-renders the body: `fix-stale-data` (A), `customize-a-template` and `use-query-files` (D), `profiles` and `migrate-from-zotero-integration` (E), the how-to and concepts hub card texts (E).
- NEW (#1677) `review-copy-troubleshoot-references` on next lacks the annotation Reference Error messages that #1696 added to `messages/en.json` (C).
- Unrenamed v1 templates "fall back to defaults" vs inert Eta document "fails with no fallback".
- `configure-frontmatter-properties` says "Update note metadata"; other pages say "Update note".
- `use-query-files` links "Filter Expression" to `how-zotlit-query-works#steps`, which does not define it; no page defines the expression language.

**Version and limit claims that only the app can confirm (all marked VERIFY in the files).**
Obsidian 1.14.2, installer 1.13.4, Zotero 9 read-only / 10 for WAL and annotation write-back, Pandoc 3.1.1, "pair saved before 2.2.0 fails on 2.2.0+", Library View caps 1,000 papers / 500 matches, Query View 5,000-paper sort cap, 256 MiB excerpt cache, edit-pdf timings (300 pt box, 100-step undo, 0.5 s nudge merge, 1 s / 10 s autosave), nine highlight colour defaults, 100-row query defaults, CSV UTF-8 BOM, `Untitled.zotquery`, 1 MB cap, graph preset colours `#E8622C / #F0793F`, Workbench "new window" vs "separate window", migrate-from-2.1 refusal rules.

**Navigation and metadata oddities.**
- `how-to/index.mdx` has no card for `migrate-from-zotero-integration`; links `/docs/install-skill` under Templates.
- Slugs that no longer match titles: `how-citekey-links-work` ("How in-text citation rendering and navigation work"), `concepts/template-workbench` ("Template Workbench CLI").
- `(intro)/index` links "Install Better BibTeX" to a section of insert-citations.
- `create-and-open-notes` mentions "the four open-under-cursor commands" without listing them; mixes five tasks; description names three.
- First-note screenshot shows "Open PDF" and "Write literature note" buttons the steps never use.
- Hard-coded English next to typed labels: "Always Allow", "Open in default browser", Zotero Settings > Advanced option name.
- ADR 0070 link in `query-files-and-query-blocks` collides with a root-level ADR 0070.
