# Tickets: First public beta release content

Four content deliverables for the `2.0.0-beta.0` release, all authored as docs-writer prose in the docs site's established tone and gated by the slop-check pass. Source spec: `.scratch/beta-release/SPEC.md`.

Work the **frontier**: any ticket whose blockers are all done. The two "start immediately" tickets can run in parallel; the two prose pieces follow so their inline links resolve against pages that already exist.

Routing is not part of this work — the changelog and blog collections, their per-version/per-slug routes, and the docs page tree already exist; the `content/changelog` and `content/blog` directories are empty and these tickets populate them. All authoring is docs-writer work; the changelog and blog pieces pass the slop-check gate. See the spec's Reference materials for primary sources (issue scan, migration plan, v1 credit page, PR sweep, CSL verification).

## Acknowledgements page

**What to build:** A new acknowledgements page in the docs intro section that a reader reaches from the intro sidebar. It carries three tiers of credit: the plugins that inspired ZotLit (obsidian-citation, BibNotes Formatter, obsidian-zotero-integration) and the community members who wrote early tutorials (FeralFlora, MichaTarlton), both migrated from the v1 docs credit section; and the external contributors whose closed-PR ideas shipped in v2 — yukiizumi3 (Obsidian note-status column in Zotero, #464), OliverDudgeon (related items in templates, #433), DanielRunningen (full date parsing #353, bulk create/update #351), theotheo (folder routing via `/` in filenames, #296), Tisen-Ray (Zotero 9 support, #466), and Ascarshen (merged v1 contribution, #459). Each contributor is named with their PR. This page is the credit target the changelog credits line and the blog post link to.

**Blocked by:** None — can start immediately.

- [x] Page lives in the docs intro section and appears in the intro sidebar
- [x] Inspiration tier migrated from v1 docs: obsidian-citation, BibNotes Formatter, obsidian-zotero-integration
- [x] Tutorial-thanks tier migrated from v1 docs: FeralFlora, MichaTarlton
- [x] Contributor tier lists all six shipped-idea contributors by name and PR number (#464, #433, #353, #351, #296, #466, #459); the typo-only PR is excluded
- [x] Prose passes the slop-check gate
- [x] Docs build is green and the page renders in the intro section

## Commands reference rows

**What to build:** The commands reference page gains rows for the two release-surface commands it currently omits — open Welcome View and open Release Note — so the reference covers the full command surface. Command identifiers come from the release service and Welcome View sources.

**Blocked by:** None — can start immediately.

- [x] Row for the open-Welcome-View command, matching the existing rows' format and `<Command>` conventions
- [x] Row for the open-Release-Note command, matching the existing rows' format
- [x] Docs build is green and both rows render in the commands reference

## Announcement blog post

**What to build:** The first entry in the blog collection: a single announcement post introducing ZotLit v2 that a curious or updating reader can read to understand the project without spelunking GitHub history. It leads with the reliability story quantified by the historical issue scan — the Electron-compatibility crashes, native-binary database failures, template rendering bugs, and stale-citekey class the rewrite structurally eliminates — then covers what's new (including Liquid as the easier-to-learn default with no JavaScript required, while Eta survives behind the per-device JavaScript Templates gate), then states v2's honest limits: no bibliography/CSL style rendering, Zotero 9 only, desktop only, no annotation search yet. It links to the acknowledgements page. It carries the narrative; it does not duplicate the changelog's curated facts.

**Blocked by:** Acknowledgements page.

- [ ] First blog entry renders at its blog route and appears in the blog index
- [ ] Reliability story names the eliminated failure classes, quantified from the issue scan
- [ ] What's-new section frames Liquid as the lowered-barrier default and states Eta remains behind the JavaScript Templates gate
- [ ] Honest-limits section states: no bibliography/CSL style rendering, Zotero 9 only, desktop only, annotation search not yet
- [ ] CSL phrasing stays constrained — improved citation insertion may be claimed; bibliography/CSL style rendering stays on the caveat list
- [ ] Links to the acknowledgements page
- [ ] Prose passes the slop-check gate
- [ ] Docs build is green

## Changelog Entry 2.0.0-beta.0

**What to build:** The first entry in the changelog collection, so the in-app Release Note action for `2.0.0-beta.0` lands on real content instead of a missing page. Its frontmatter records `version: 2.0.0-beta.0` and `companion: 2.0.0-beta.0` (date filled at release time). It leads with a short curated highlights list and a lead paragraph linking the announcement blog post for the narrative. A breaking-changes section states plainly what stops working and what the user must do — minimum Obsidian 1.12.7 and Electron 39, custom v1 Eta templates inert until renamed/rewritten to `zt.*` vocabulary and gated on, v1 notes needing a one-time overwrite for the Managed Region, companion lockstep, and the removed Zotero data-directory setting — and links to the migration guide rather than restating its steps. A two-part gap list separates "not yet ported" (Topic-import, annotation merging, Better Notes import compatibility) from "removed" (pre-native-citekey Better BibTeX / ATTACH-database support, the v1 annotation callout format, annot-view jump-to-note). A credits line links the acknowledgements page. This entry establishes the Changelog Entry shape (highlights, breaking changes, gaps, credits) for later releases.

**Blocked by:** Announcement blog post, Acknowledgements page.

- [ ] Entry renders at the `2.0.0-beta.0` per-version changelog route and appears in the changelog index
- [ ] Frontmatter carries `version` and `companion` both `2.0.0-beta.0`; date is filled at release time
- [ ] Lead paragraph links the announcement blog post; curated highlights list leads the entry
- [ ] Highlights cover the settled list (node:sqlite DB access, Liquid default + Eta gated, batch create/update, Zotero note import, citation upgrades, Welcome View with guided migration, docs site) and exclude the Template Data Explorer and live-updates/follow-mode from top billing
- [ ] Breaking-changes section covers Obsidian 1.12.7 / Electron 39 minimums, template rename + `zt.*` vocabulary + JavaScript Templates gate, one-time note overwrite, companion lockstep, and the removed data-directory setting; links the migration guide instead of restating it
- [ ] Gap list is split: "not yet ported" (Topic-import, annotation merging, Better Notes import) vs "removed" (pre-native-citekey BBT/ATTACH, v1 annotation callout format, annot-view jump-to-note)
- [ ] Credits line links the acknowledgements page
- [ ] Prose passes the slop-check gate
- [ ] Docs build is green and renders the changelog index and the per-version page
