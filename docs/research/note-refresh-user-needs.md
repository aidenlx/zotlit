# What "refresh the note without losing my writing" is for

Source study, 2026-10-23. This report records source observations. It
recommends no design.

Every plugin that turns a Zotero item into an Obsidian note gets the same
request: update or refresh the note without losing what I wrote. Zotero
Integration answers it with `{% persist %}` blocks. ZotLit v1 answered with
re-render and in-place update, and ZotLit v2 answers with the
`%%zt-managed%%` region. This report asks what users need underneath that
request. It does four things:

- It splits the request into the jobs users are doing.
- For each job, it records what users do and ask, and which mechanism
  serves it.
- It weighs what a live view gives up compared with a copy, given two
  maintainer decisions taken on 2026-10-23.
- It answers a second question in its own section: does anyone need the
  implicit import of Zotero child notes that the default template performs
  today?

A companion page, `note-refresh-user-needs.html` in this folder, explains the
same findings with diagrams. This Markdown file is the citable source.

Neighbouring needs are covered in
[`annotation-search-user-needs.md`](https://github.com/aidenlx/zotlit/blob/research/annotation-search-user-needs/docs/research/annotation-search-user-needs.md)
on the branch `research/annotation-search-user-needs`. That report is about
searching annotations and inserting one at the cursor. Its section I4
("a reference, not a copy") and its Tension 3 ("Copy or reference") bear on
this one. This report links to them and does not repeat them.

## Fixed inputs

These were given by the maintainer. This report treats them as fixed and
does not re-argue them.

**Product stances**, recorded in the third-party handoff:

- S1. Notes are managed in Obsidian.
- S2. ZotLit uses Zotero's features, but does no full two-way sync of the
  kind ZotFlow or Better Notes do.
- S3. Note-taking does not move into Zotero.

**Decisions, 2026-10-23:**

- D1. **No block-ID references to annotations.** ZotLit will not support
  referencing a highlight through a `^…` block ID that carries the
  annotation key. The durable Zotero annotation URI serves that need
  instead: `zotero://open/library/items/<attachment>?annotation=<key>`. It
  already has a hover preview and click-to-open (the "Durable Annotation
  Link" in `apps/obsidian/src/services/annotation-popover/`).
- D2. **Annotation URIs join the Citation Index.** Every Zotero annotation
  URI in the vault will be indexed. Obsidian already records Markdown links
  in `metadataCache`. This gives "where is this annotation used" and
  backlinks to a highlight without writing the highlight's text into a
  file.

## Sources and method

Every claim below carries one of three source labels:

- **(handoff)**: the third-party findings report
  `zotlit-managed-region-research-handoff.md`, dated 2026-10-23 09:30
  UTC+8 and written in Chinese. It covers:
  - jobs and triggers;
  - Zotero Integration's persist, read from source at `2043211d`;
  - ZotLit v2, the Citations plugin, Readwise, Kindle, Omnivore, Logseq,
    Better Notes, ZotFlow and Dataview;
  - what Zotero Query covers;
  - child-note personas P1–P7.

  It was not re-crawled. Its key citations were spot-checked (table
  below).

- **(prior crawl)**: the maintainer's notes repo at `~/aidenlx-repo/notes/agents/`,
  report _Make each Zotero annotation an Obsidian object_ (2026-10-04) and
  `research_notes/Obsidian PDF annotation integration/`. That is a Reddit
  crawl of 32 threads and a Discord crawl of five channels
  (`reddit_feedback.md`, `discord_feedback.md`), plus
  `zotero_obsidian_ecosystem.md` and `other_software_annotation_models.md`.
  These were not reopened.
- **(new)**: collected for this report on 2026-10-23.
  - **GitHub** (`gh api graphql`). Every issue and the first 100 comments
    per thread were downloaded and searched locally.
    - `community-archive/obsidian-zotero-integration`: 460 issues. It
      moved from `mgmeyers/`; the old URLs redirect. Abbreviated **ZI**
      below.
    - `hans/obsidian-citation-plugin`: 254 issues.
    - `aidenlx/zotlit`: 337 non-maintainer issues and 121 discussions.
      `aidenlx/obsidian-zotero` redirects here, so v1 issues are its early
      numbers.
    - `stefanopagliari/bibnotes`: 160 issues.
    - `duanxianpi/zotflow`: 122 issues.
    - `windingwind/zotero-better-notes` (abbreviated **BN**): issues and
      516 discussions.
    - `RyotaUshio/obsidian-pdf-plus`: issues and 161 discussions.
    - Readwise, Hypothesis, Kindle, Omnivore and Logseq issues.
  - **Forums**: Obsidian forum through Discourse JSON; Zotero forums as
    HTML; Reddit through the Arctic Shift archive, because reddit.com
    refused scripted requests.
  - **Code**: ZotLit v2 on `origin/next` at `5bfdc4d92`.

**Spot-check of the handoff's load-bearing citations** (new, 2026-10-23,
via `gh issue view`, `gh api graphql` and fetches):

| Citation                                                                                                                                                                          | Handoff's use                                                                              | Result                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [ZI #351](https://github.com/community-archive/obsidian-zotero-integration/issues/351)                                                                                            | silent overwrite, r=4, c=8                                                                 | **Verified**: "Importing the same file twice overwrites existing Obsidian Note without warning", 2024-03-09, +4                                                                                                                                              |
| [ZI #317](https://github.com/community-archive/obsidian-zotero-integration/issues/317)                                                                                            | frontmatter ownership, r=5; Obsidian strips YAML comments                                  | **Verified**: 5 reactions in total (none 👍); "I may want to re-run a template, updating the Zotero metadata, and keep my Obsidian notes and metadata intact"                                                                                                |
| [ZI #475](https://github.com/community-archive/obsidian-zotero-integration/issues/475)                                                                                            | persistent frontmatter                                                                     | **Verified**: "Allow persistent Frontmatter", 2026-04-16, +4                                                                                                                                                                                                 |
| [ZI #216](https://github.com/community-archive/obsidian-zotero-integration/issues/216)                                                                                            | auto-update, r=11                                                                          | **Verified**: 2023-04-19, +11                                                                                                                                                                                                                                |
| [ZI #274](https://github.com/community-archive/obsidian-zotero-integration/issues/274)                                                                                            | summary written in Zotero's note panel                                                     | **Verified**: "Templating for notes (not annotations)", 2023-08-29                                                                                                                                                                                           |
| [ZotLit #94](https://github.com/aidenlx/zotlit/issues/94)                                                                                                                         | "a single clean snapshot of the state of a paper", used as evidence for _frozen snapshots_ | **Contradicted in use**: the quote is real, but the request is to "directly embed in a literature note the content of the highlights/annotation panel", that is a _live_ embed. "Snapshot" means an overview of the paper's current state, not a frozen copy |
| [ZotLit #109](https://github.com/aidenlx/zotlit/issues/109)                                                                                                                       | anchors in list items                                                                      | **Verified**: "support for checking list item block-id in Note Updates", 2023-03-26                                                                                                                                                                          |
| [ZotLit #294](https://github.com/aidenlx/zotlit/issues/294)                                                                                                                       | copies outside the lit note go stale                                                       | **Verified**: "Update annotations embedded outside literature notes", 2024-01-17                                                                                                                                                                             |
| [ZotLit #414](https://github.com/aidenlx/zotlit/issues/414)                                                                                                                       | child-note copies stale                                                                    | **Verified**: "Zotero Notes Content are not updated after Obsidian Literature Note is created", 2025-03-06                                                                                                                                                   |
| [ZotLit #485](https://github.com/aidenlx/zotlit/issues/485)                                                                                                                       | users expect child notes to follow Zotero                                                  | **Partly contradicted**: the issue is a stale-database bug (Update and Overwrite did nothing until "Refresh Zotero Database"), for lit notes and child notes alike. It shows that users press Update on child notes, not a stated expectation                |
| [ZotLit #494](https://github.com/aidenlx/zotlit/issues/494)                                                                                                                       | "I generally use many atomic notes"                                                        | **Verified**: an issue, 2026-07-24                                                                                                                                                                                                                           |
| [BN #1198](https://github.com/windingwind/zotero-better-notes/issues/1198)                                                                                                        | maintainer refuses whole-library export: "more than chaos"                                 | **Verified**: the maintainer comment; the requester wants to "export them all to Obsidian for management" with bidirectional updates                                                                                                                         |
| [ZotLit discussion #944](https://github.com/aidenlx/zotlit/discussions/944)                                                                                                       | plugin- or AI-generated child notes imported empty, fixed in 2.1.4                         | **Verified**, with a note: the discussion says "created by a Zotero plugin" or "by automation". "AI" is the handoff's own gloss                                                                                                                              |
| [ZotLit discussion #1274](https://github.com/aidenlx/zotlit/discussions/1274)                                                                                                     | 2.1.4 dropped `%%/zt-managed%%`                                                            | **Verified**: 2026-09-29 (UTC)                                                                                                                                                                                                                               |
| [ZI `template.env.ts` L148–198](https://github.com/community-archive/obsidian-zotero-integration/blob/2043211d87ff2ca5db31bf587b5024eac9f49171/src/bbt/template.env.ts#L148-L198) | persist has append semantics                                                               | **Verified**: `run()` returns `%% begin id %%${retained}${trimmed}%% end id %%`, the old content followed by the new render                                                                                                                                  |
| [Readwise docs](https://docs.readwise.io/readwise/docs/exporting-highlights/obsidian)                                                                                             | append-only rationale                                                                      | **Verified**: "Because the Readwise plugin is append-only, nothing in Obsidian will ever be overwritten"; "it would be quite technically challenging…"                                                                                                       |
| [Kindle discussion #27](https://github.com/hadynz/obsidian-kindle-plugin/discussions/27)                                                                                          | first never touched synced books                                                           | **Verified**: "the plugin will never overwrite or modify this file even if new highlights have been detected" (2021-05-10)                                                                                                                                   |
| [omnivore#45](https://github.com/omnivore-app/obsidian-omnivore/issues/45)                                                                                                        | local edits overwritten                                                                    | **Verified**: "Keep local note modifications in subsequent updates", 2023-04-13, 31 reactions                                                                                                                                                                |
| [Dataview #465](https://github.com/blacksmithgu/obsidian-dataview/issues/465), [#2486](https://github.com/blacksmithgu/obsidian-dataview/issues/2486)                             | query results not indexed                                                                  | **Verified**: "No links are ever indexed into the Obsidian graph"; notes "collected by dataview" missing from graph view                                                                                                                                     |

Nothing was "not reachable". Also spot-checked from the new collection:

- GitHub: ZI #216, ZI #475, Citation #215 (+8), ZotLit #318 (+8),
  Bibnotes #104 (+3), ZotFlow #124, ZI #414.
- Obsidian forum: threads 94872, 74839 and 50886.

All matched.

**Limits.** Reaction counts are small; the highest on-topic count is 31
(omnivore#45), and 11 for a Zotero tool. **Signal strength therefore means
the approximate number of independent voices across all three sources**, not
votes. Many items concern Zotero Integration, Bibnotes or ZotLit v1. They
show what users need from an update. A v1 report is not evidence of a v2
defect. Discord after 2026-10-04 was not read, and no connector exists for it
(handoff). Notion importers were not studied.

## Context: what ZotLit v2 does today

From the code (new). These are current-state facts, not findings about
users.

- **The managed region.** A literature note has one managed region between
  `%%zt-managed%%` and `%%/zt-managed%%`. An update replaces the first such
  region and leaves the rest of the note alone (`replaceManagedRegion` in
  `packages/templates/src/obsidian.ts`). The n-th ` ```zotquery ` block of
  the old region keeps its text through the update, so view settings saved
  from the toolbar survive.
- **The default region.** `packages/templates/defaults/content.liquid`
  holds two sections:
  - `## Notes`: a `{{ note.noteLink }}` for each `zt.notes` entry;
  - `## Annotations`: a Query Block over `from: annotations` with
    `filters: item == this.item`, since `41ed0fa0e` on 2026-10-14.
    New annotations appear without an update.
- **Frontmatter.** Frontmatter is managed field by field (ADR 0052), and
  keys the user adds are kept. A metadata-only update refreshes the
  frontmatter without the body (`apps/docs/content/docs/how-to/keep-notes-updated.mdx`).
- **Updates are manual.** You can update one note, a selection started from
  Zotero, or all notes. Batch updates show a confirmation grouped by
  status. "Overwrite" replaces the whole body after a confirmation.
- **Inserted annotations.** The default annotation template
  (`packages/templates/defaults/annotation.liquid`) writes a callout. The
  callout holds the quoted text, the citation, the comment, and a
  `zt.backlink` page link, which is the durable annotation URI.
- **Comments.** Annotation comments can be edited from Obsidian and are
  written to Zotero (`apps/docs/content/docs/how-to/edit-pdf-annotations.mdx`).
  This needs Zotero 10 running.
- **Desktop only.** The plugin is desktop-only (`manifest.json`:
  `"isDesktopOnly": true`).
- **Previews and export.** A Query Block shows a placeholder in a note
  preview and does not save in print or export (header comment of
  `apps/obsidian/src/views/query-view/block.ts`).

## The jobs behind the request

Each job has three parts:

- **Asked**: what users say, with source labels.
- **Signal**: the rough number of independent voices.
- **Inference**: the author's reading, labelled as such.

```
"refresh without losing my writing"
 ├─ things that come FROM Zotero and should arrive
 │   J1 new annotations · J2 edited annotations · J3 deleted annotations
 │   J4 metadata changes · J5 template changes · J8 many notes at once
 ├─ things the user WROTE and must survive
 │   J6 a thought next to one highlight · J7 own sections and properties
 └─ the conditions on both
     J9 never lose work silently · J10 when it happens (auto or manual)
     J11 references to a highlight keep working
```

The handoff names five triggers for a refresh:

1. a metadata fix in Zotero;
2. new annotations;
3. a template change or a bulk migration;
4. an accidental or habitual re-import ("if I accidentally rerun the
   plugin", ZI #351);
5. drift across devices or sync tools (ZI #362).

The jobs below cover all five.

### J1. New highlights appear in the note

**Asked.**

- "I wish I didn't have to rerun the command in Obsidian every time to fetch
  the new/modified annotations, and frequently forget"
  ([ZI #216](https://github.com/community-archive/obsidian-zotero-integration/issues/216),
  2023, +11) (handoff, new).
- "It seems to work great as long as one does not need to make new
  annotations in Zotero"
  ([forum 74945](https://forum.obsidian.md/t/74945), 2024) (new).
- "when I make new annotations, it also updates the new highlight but
  removes all the notes I wrote"
  ([forum 74839](https://forum.obsidian.md/t/74839), 2024, 3,970 views) (new).
- Persist makes new annotations land "into a new 'date chunk'"
  ([Reddit](https://www.reddit.com/r/ObsidianMD/comments/1bvc4wc/help_updating_annotations_into_a_note/),
  2024). Another user: "two chunks of annotations without being able to
  identify new annotations"
  ([forum 36310/304](https://forum.obsidian.md/t/36310/304)). Others report
  new highlights "always added at the bottom"
  ([forum 49867](https://forum.obsidian.md/t/49867)) (new).
- Duplicates on re-import:
  - "ALL the old and new annotations are duplicated"
    ([ZI #29 comment](https://github.com/community-archive/obsidian-zotero-integration/issues/29#issuecomment-1103201863))
    (new);
  - a whole note wrapped in persist doubles its annotations
    ([ZI #335](https://github.com/community-archive/obsidian-zotero-integration/issues/335))
    (handoff, new);
  - Readwise "appends the entire highlights… again"
    ([forum 22311/12](https://forum.obsidian.md/t/22311/12))
    (new).
- Appending by date breaks:
  - timezones ([ZI #180](https://github.com/community-archive/obsidian-zotero-integration/issues/180));
  - `lastExportDate` stuck at 1970
    ([ZI #377](https://github.com/community-archive/obsidian-zotero-integration/issues/377));
  - first-import detection across git-synced machines
    ([ZI #362](https://github.com/community-archive/obsidian-zotero-integration/issues/362)).

  `lastImportDate` is parsed from a `%% Import Date %%` footer, and it fails
  if that footer is edited
  ([template.helpers.ts L52–69](https://github.com/community-archive/obsidian-zotero-integration/blob/2043211d87ff2ca5db31bf587b5024eac9f49171/src/bbt/template.helpers.ts#L52-L69))
  (handoff).

- Create-only tools:
  - "it just create the note but doesn't update it anymore"
    ([Bibnotes #30](https://github.com/stefanopagliari/bibnotes/issues/30));
  - Kindle originally skipped any book synced before
    ([discussion #27](https://github.com/hadynz/obsidian-kindle-plugin/discussions/27))
    (handoff, new);
  - ZotLit v1's annotation view was live, "but the annotation in the note is
    not updated" ([ZotLit #87](https://github.com/aidenlx/zotlit/issues/87))
    (new).
- A persist-and-timestamp fix: "when I try to import the note again from
  Zotero nothing changes, so any new annotations that were made do not show
  up"
  ([forum 102028](https://forum.obsidian.md/t/how-to-preserve-annotations-and-meta-information-when-re-importing-from-zotero/102028), 2025) (prior crawl).
- Counter-practice: "import annotations only after I have finished reading
  in Zotero"
  ([ZI #156 comment](https://github.com/community-archive/obsidian-zotero-integration/issues/156#issuecomment-1713192960))
  (new).

**Signal: strong, about 22 voices.**

**Inference.** Users who read in several sessions need the note to catch up,
and they forget to re-run the import. Append is the common mechanism. It
fails on clocks, sync and migration, and it scatters new highlights into
dated chunks. The handoff and this report agree that the v2 Query Block takes
J1 out of the update path for annotations shown in the note.

### J2. Edits made in Zotero reach the note

**Asked.**

- ZotLit v1: "already existing annotations are not getting updated"
  ([ZotLit #286](https://github.com/aidenlx/zotlit/issues/286)) (new).
- Readwise:
  - edits do not sync ("At the moment, no",
    [docs](https://docs.readwise.io/readwise/docs/exporting-highlights/obsidian));
  - "The only way to reliably get them is to delete everything and sync
    again" ([readwise #29](https://github.com/readwiseio/obsidian-readwise/issues/29),
    +3);
  - the per-note delete-and-reimport "it's not scalable"
    ([readwise #34](https://github.com/readwiseio/obsidian-readwise/issues/34));
  - from the Readwise launch thread: "it will no longer sync through new
    notes on highlights"
    ([forum 22311/8](https://forum.obsidian.md/t/22311/8)).

  (handoff, new)

- Hypothesis: "I made a change to an annotation note and the data in
  Obsidian did NOT change"
  ([hypothesis #55](https://github.com/weichenw/obsidian-hypothesis-plugin/issues/55)).
  The cause was the default template's `{% if is_new_article %}` (new).
- "My biggest issue is always to decide where to update annotations, in
  Zotero or in Obsidian :("
  ([ZI #7 comment](https://github.com/community-archive/obsidian-zotero-integration/issues/7#issuecomment-1466102353))
  (new).
- Copies dragged elsewhere go stale: "How do I update these annotations?"
  ([ZotLit #294](https://github.com/aidenlx/zotlit/issues/294);
  [discussion #334](https://github.com/aidenlx/zotlit/discussions/334))
  (handoff, new).
- The reverse direction loses edits:
  - "Force update source note discards annotation comment edits that have
    not yet synced… There is no warning"
    ([ZotFlow #124](https://github.com/duanxianpi/zotflow/issues/124));
  - a user corrects the quoted text in Obsidian and wants it pushed back
    ([Zotero forum 118430](https://forums.zotero.org/discussion/118430))
    (new).
- A first-time asker: "What happens when I edit the annotation"
  ([Reddit](https://www.reddit.com/r/ObsidianMD/comments/1pzvjj1/), 2026)
  (new).

**Signal: moderate, about 14 voices.**

**Inference.** A user fixes a typo or adds a comment in Zotero and expects
every copy to follow. Copies spread beyond the literature note, so even a
perfect update of one note leaves stale copies in summary and topic notes.
Under S2, the Zotero side is the source for annotation text and comments.
Edits made in Obsidian go to Zotero, as ZotLit's comment editor does, or they
are the user's own text.

### J3. Deleted annotations leave the note

**Asked.**

- "When I delete a highlight on Zotero, the vault lit note does not delete"
  ([ZotLit discussion #148](https://github.com/aidenlx/zotlit/discussions/148),
  two users) (new).
- In BibNotes, "it also doesn't deletes removed annotations"
  ([forum 29920/23](https://forum.obsidian.md/t/29920/23)). Its maintainer
  explained: "existing ones are not deleted/overwritten to avoid deleting…
  something that I had added to the note manually"
  ([29920/24](https://forum.obsidian.md/t/29920/24)) (new).
- Kindle: "If I delete highlights from the book itself, will it delete them"
  ([forum 17740/31](https://forum.obsidian.md/t/17740/31)). Another user
  asks what happens to links into the note
  ([17740/17](https://forum.obsidian.md/t/17740/17)) (new).
- Leftover image files
  ([ZotLit #338](https://github.com/aidenlx/zotlit/issues/338);
  [ZotFlow #48 comment](https://github.com/duanxianpi/zotflow/issues/48#issuecomment-4526179493)).
  For a deleted item: "delete it as well… Or a way to mark notes"
  ([ZotFlow #54](https://github.com/duanxianpi/zotflow/issues/54)) (handoff,
  new).
- Zotero's lead developer: "'updating' an existing note where annotations
  might have been edited, deleted, duplicated, or moved around is far from
  straightforward"
  ([Zotero forum 94513](https://forums.zotero.org/discussion/94513)) (prior
  crawl, new).

**Signal: moderate, about 9 voices.**

**Inference.** Users split between "remove it" and "mark it". In a copy,
deletion collides with anything the user wrote under or linked to the
highlight. A live view handles deletion for free; the handoff lists ZotLit
#97, #290, #338 and #115 as covered by Query.

### J4. Metadata changes reach the note

**Asked.**

- "the integration with Zotero is static… [update] the literature note…
  when I change / add a tag in Zotero"
  ([Citation #215](https://github.com/hans/obsidian-citation-plugin/issues/215),
  +8). "If the values for a source in Zotero change (eg the year), the note
  won't be updated"
  ([#154](https://github.com/hans/obsidian-citation-plugin/issues/154),
  +7). "Currently you have to delete and re-add"
  ([#174](https://github.com/hans/obsidian-citation-plugin/issues/174),
  +5, for "hundreds or thousands of notes") (handoff, new).
- Metadata only, not the annotations:
  - "update some of the author, title, or tag info in Zotero, but not the
    annotations"
    ([ZI #281](https://github.com/community-archive/obsidian-zotero-integration/issues/281#issuecomment-3124340642));
  - "Corrections of the metadata in Zotero… are currently not changed in
    Obsidian"
    ([ZotLit #439](https://github.com/aidenlx/zotlit/issues/439));
  - "users sometimes only want to update one of them"
    ([ZotLit #477](https://github.com/aidenlx/zotlit/issues/477)).

  The abstract was not refreshed in v1
  ([ZotLit #124](https://github.com/aidenlx/zotlit/issues/124)). (handoff,
  new)

- Readwise: "for metadata I believe that it should always be synced"
  ([readwise #21](https://github.com/readwiseio/obsidian-readwise/issues/21)).
  A 2026 comment adds that `document_note` is not updated either (handoff,
  new).
- Reddit:
  - "adding new tags… and re-import, Obsidian seems to overwrite the note
    completely"
    ([Reddit](https://www.reddit.com/r/ObsidianMD/comments/1ndfoj4/obsidian_zotero_integration_how_to_update/),
    2025);
  - "auto updating metadata… without reimporting the whole note"
    ([Reddit](https://www.reddit.com/r/ObsidianMD/comments/17hlasw/zotero_integration_update_note/),
    2023).

  (new)

- The citekey should rename the file
  ([ZotLit discussion #301](https://github.com/aidenlx/zotlit/discussions/301)).
  Tags are "the main way to organize papers"
  ([ZotFlow #50](https://github.com/duanxianpi/zotflow/issues/50)) (new).

**Signal: strong, about 18 voices.**

**Inference.** Users treat metadata as Zotero's. They fix it in Zotero and
want Obsidian to follow, often in bulk (J8). It lives in frontmatter, where
Bases and Dataview read it, so it must be file text. ZotLit v2's
metadata-only update and field-level frontmatter address this job directly.

### J5. Re-render after a template change

**Asked.**

- "Auto update all literature note after changing template"
  ([Citation #88](https://github.com/hans/obsidian-citation-plugin/issues/88),
  +4). A counter-voice in the same thread: "tricky to know whether you've
  updated it since, and you'd lose the new information"
  ([comment](https://github.com/hans/obsidian-citation-plugin/issues/88#issuecomment-866763820))
  (new).
- "auto update all references… [after] a new template"
  ([ZI #418](https://github.com/community-archive/obsidian-zotero-integration/issues/418),
  two users) (handoff, new).
- Formats get mixed when a template change applies only to new highlights:
  - Kindle ([#284](https://github.com/hadynz/obsidian-kindle-plugin/issues/284),
    and a template filter that broke diffing,
    [#101](https://github.com/hadynz/obsidian-kindle-plugin/issues/101));
  - Readwise, where deleting all notes is the only way to apply a template
    change ([readwise #29 comment](https://github.com/readwiseio/obsidian-readwise/issues/29)).

  (handoff, new)

- Template mistakes corrupt user regions:
  - `[object Object]` in an editable region
    ([ZotFlow #79](https://github.com/duanxianpi/zotflow/issues/79));
  - the v2 closing marker disappeared on update
    ([ZotLit discussion #1274](https://github.com/aidenlx/zotlit/discussions/1274));
  - "Duplicate heading" with a colour-grouped template
    ([ZotLit #115](https://github.com/aidenlx/zotlit/issues/115), v1).

  (handoff, new)

- ZotFlow's answer: a region removed from the template "moves to a
  clearly-marked section at the bottom… instead of being deleted"
  ([Reddit, developer](https://www.reddit.com/r/ObsidianMD/comments/1v0kulm/))
  (new).

**Signal: moderate, about 9 voices.**

**Inference.** Users iterate on templates, mostly early on, and want old
notes to match. It is the riskiest update, because a template edit can move
or drop the boundary between generated and user text. The handoff names the
tension: an editable template versus consistency across old notes.

### J6. A thought next to one highlight

**Asked.**

- "I add some notes between highlights as well as a summary section above"
  ([Bibnotes #13](https://github.com/stefanopagliari/bibnotes/issues/13)).
  "manual comments and highlights exported together in their original
  context"
  ([Bibnotes #104](https://github.com/stefanopagliari/bibnotes/issues/104),
  +3). Maintainer: "not possible to make this distinction line by line"
  (new).
- Progressive processing: "This would allow a user to progressively process
  highlights sync'ed to Obsidian", with Readwise's append-only behaviour as
  the model
  ([omnivore#45 comment](https://github.com/omnivore-app/obsidian-omnivore/issues/45))
  (handoff, new).
- "I only distinguish between my words, and the authors words"
  ([ZotFlow #88 comment](https://github.com/duanxianpi/zotflow/issues/88#issuecomment-5107803933));
  notes written while annotating were blanked on update
  ([ZotLit #233](https://github.com/aidenlx/zotlit/issues/233), v1) (handoff,
  new).
- Zotero Integration's own docs pitch append-only for this: it "would then
  allow you to… edit annotations or annotation comments, and add additional
  notes to annotations"
  ([Templating.md](https://github.com/community-archive/obsidian-zotero-integration/blob/main/docs/Templating.md))
  (handoff).
- "I've been deleting original notes and re-importing them again, though I
  lose my processing comments and key takeaways"
  ([forum 36310/317](https://forum.obsidian.md/t/36310/317)) (new).
- One note per annotation, so there is room to write
  ([Reddit](https://www.reddit.com/r/ObsidianMD/comments/1raotky/), 2026;
  [Reddit](https://www.reddit.com/r/ObsidianMD/comments/1tbtsfx/), 2026;
  [ZotLit discussion #507](https://github.com/aidenlx/zotlit/discussions/507))
  (new).

**Signal: moderate, about 10 voices.** These are some of the most detailed
reports.

**Inference.** The user's text sits inside the generated list, so no region
boundary can protect it. The evidence shows four homes for such a thought:

1. the Zotero annotation comment, which is Zotero's data and shows
   wherever the annotation shows;
2. a frozen, append-only copy that the user writes into;
3. a separate note that quotes or links the highlight;
4. a note per annotation.

Users ask for (2) most often. Nobody in the sample asked to type into a live
view. Under S3, (1) is limited to the comment field, which ZotLit can already
edit from Obsidian. Under D1 and D2, (3) can carry a durable URI that is
indexed (see [J11](#j11-references-to-a-highlight-keep-working)).

### J7. Own sections and properties elsewhere in the note

**Asked, body.**

- "some notes that I wrote manually will be LOST"
  ([ZI #282](https://github.com/community-archive/obsidian-zotero-integration/issues/282)).
  Persist blocks get overwritten or duplicated
  ([ZI #157](https://github.com/community-archive/obsidian-zotero-integration/issues/157),
  [#301](https://github.com/community-archive/obsidian-zotero-integration/issues/301),
  [#309](https://github.com/community-archive/obsidian-zotero-integration/issues/309),
  [#415](https://github.com/community-archive/obsidian-zotero-integration/issues/415))
  (handoff, new).
- "# Takeaways (edited in Obsidian) # Annotations (synced from Zotero)… any
  content added using Obsidian will be lost"
  ([ZI #403](https://github.com/community-archive/obsidian-zotero-integration/issues/403));
  "if I re-import the article, the summary I've written is gone"
  ([forum 97877](https://forum.obsidian.md/t/97877)) (new).
- "custom note that one would like to keep unchanged… quite common"
  ([ZotLit #251](https://github.com/aidenlx/zotlit/issues/251), +3) (handoff,
  new).
- Omnivore:
  - "on next update all my local modifications to obsidian note are
    overridden… this setup isn't useful in a PKM"
    ([omnivore#45](https://github.com/omnivore-app/obsidian-omnivore/issues/45),
    31 reactions);
  - "sufficient, if there is a 'marked' area at the bottom" (same thread).

  (handoff, new)

- Protected sections corrupted
  ([Bibnotes #57](https://github.com/stefanopagliari/bibnotes/issues/57),
  [#80](https://github.com/stefanopagliari/bibnotes/issues/80)). "preserve
  part of the notes that I write in Obsidian"
  ([ZotFlow #57](https://github.com/duanxianpi/zotflow/issues/57)), which
  shipped as persist regions (new).
- Success: "my notes in Obsidian remain"
  ([Reddit r/PhD](https://www.reddit.com/r/PhD/comments/1jn4djh/comment/mkqkdyg/), 2025) (prior crawl). Handwritten edits outside the persist block vanish
  ([Discord](https://discord.com/channels/686053708261228577/722584061087842365/1507718735346008198), 2026) (prior crawl).

**Asked, frontmatter.** The handoff calls this the most frequent pain point:
Zotero-owned keys (title, authors, citekey) should refresh, and user-owned
keys (status, subject, summary, aliases) should stay.

- "I want to use yaml frontmatter for… status tracking"
  ([ZI #60](https://github.com/community-archive/obsidian-zotero-integration/issues/60),
  three users). Further asks:
  [ZI #138](https://github.com/community-archive/obsidian-zotero-integration/issues/138);
  "a `rating: 9` key that get overwritten"
  ([ZI #201 comment](https://github.com/community-archive/obsidian-zotero-integration/issues/201#issuecomment-1515130336));
  "I use my front matter to organise my papers by subject"
  ([ZI #475](https://github.com/community-archive/obsidian-zotero-integration/issues/475),
  +4) (handoff, new).
- "with the new Bases feature, it's frustrating not to be able to persist
  certain file properties"
  ([ZI #351 comment](https://github.com/community-archive/obsidian-zotero-integration/issues/351#issuecomment-3450535142)).
  The community workaround works only at first import
  ([comment](https://github.com/community-archive/obsidian-zotero-integration/issues/351#issuecomment-3806542702))
  (handoff).
- Obsidian deletes YAML comments when it edits properties, so comment
  markers cannot protect frontmatter
  ([ZI #317 comment](https://github.com/community-archive/obsidian-zotero-integration/issues/317#issuecomment-1857522536))
  (handoff).
- Forum and Reddit voices:
  - "the creation date property gets cleared"
    ([forum 97588](https://forum.obsidian.md/t/97588));
  - "I want to persist the date when the note was first created"
    ([forum 36310/360](https://forum.obsidian.md/t/36310/360));
  - "I do my 'read status' tags in Obsidian, not in Zotero"
    ([Reddit](https://www.reddit.com/r/ObsidianMD/comments/1nikwi3/));
  - a workaround: "do all my tagging in Zotero"
    ([forum 87651](https://forum.obsidian.md/t/87651)).

  (new)

- Reading-status fields blanked by ZotFlow
  ([Reddit](https://www.reddit.com/r/ObsidianMD/comments/1tfke0n/comment/onlh145/))
  (prior crawl). Better Notes resets YAML on sync
  ([BN #527](https://github.com/windingwind/zotero-better-notes/issues/527),
  four users) (new).

**Signal: strongest, about 30 voices**, split about evenly between body and
frontmatter.

**Inference.** This is the core of the request. Users write a summary, a
critique, and key results. They add properties for status, rating, subject
and creation date. All of it must survive any update, including mistaken
ones. Frontmatter is one YAML block with keys of mixed ownership, and
comment markers cannot live in it.

### J8. Many notes at once

**Asked.**

- "automatically syncs all my notes without having to sync them one by one"
  ([ZotLit #318](https://github.com/aidenlx/zotlit/issues/318), +8). "I have
  to update their notes one by one"
  ([ZotLit #269](https://github.com/aidenlx/zotlit/issues/269), +3)
  (handoff, new).
- "import a full library at once"
  ([forum 76254](https://forum.obsidian.md/t/76254), 5,441 views, 11 likes);
  "~10 papers to read everyday"
  ([forum 69120/6](https://forum.obsidian.md/t/69120/6)); "for all items
  within this collection/library"
  ([Zotero forum 99187](https://forums.zotero.org/discussion/99187)) (new).
- Dangers:
  - "mistakenly used the 'update all' command and it was a mess to roll
    back as I have 2000+ pdfs"
    ([Bibnotes #11](https://github.com/stefanopagliari/bibnotes/issues/11));
  - update existing notes only
    ([ZotFlow #125](https://github.com/duanxianpi/zotflow/issues/125));
  - "only sync those items that I have referenced"
    ([ZotFlow #82](https://github.com/duanxianpi/zotflow/issues/82)).

  (new)

- The handoff reads "update all notes" as a template migration that users
  want to preview and undo.

**Signal: moderate to strong, about 12 voices.**

**Inference.** Bulk is how J4 and J5 are actually done. Its users want a clear
scope and a dry run, because a bulk mistake multiplies J9.

### J9. Never lose work silently

**Asked.**

- "This is scary and I have lost one set of notes"; "people import papers
  without noticing it was already there and destroy hours of work"
  ([ZI #420](https://github.com/community-archive/obsidian-zotero-integration/issues/420#issuecomment-2696317640)).
  "overwritten without any warning"
  ([ZI #351](https://github.com/community-archive/obsidian-zotero-integration/issues/351)).
  [ZI #201](https://github.com/community-archive/obsidian-zotero-integration/issues/201)
  (+3) reports old Citations-plugin notes overwritten in batches (handoff,
  new).
- Omnivore: "I took one big note from a video. And today, after syncing,
  it's all gone!"; "forbid overwriting existing files"
  ([omnivore#45](https://github.com/omnivore-app/obsidian-omnivore/issues/45))
  (handoff, new).
- Better Notes:
  - one note "overwritten the notes of five other Zotero items"
    ([BN #1388](https://github.com/windingwind/zotero-better-notes/issues/1388));
  - "completely blank"
    ([BN #1519](https://github.com/windingwind/zotero-better-notes/issues/1519));
  - "only read/sync one way?"
    ([BN #1309](https://github.com/windingwind/zotero-better-notes/issues/1309)).

  (new)

- Duplicates instead of updates:
  - after moving a note ([forum 96697](https://forum.obsidian.md/t/96697));
  - Readwise on moved or renamed files
    ([readwise #14](https://github.com/readwiseio/obsidian-readwise/issues/14),
    [#100](https://github.com/readwiseio/obsidian-readwise/issues/100));
  - Hypothesis
    ([#19](https://github.com/weichenw/obsidian-hypothesis-plugin/issues/19));
  - Logseq: "duplicates page content… as many times as you enter the
    citation", until an overwrite setting is switched on
    ([logseq#3442](https://github.com/logseq/logseq/issues/3442)).

  (handoff, new)

- "When nothing changes… I would prefer the '%% Import Date…' is not
  updated"
  ([ZI #279 comment](https://github.com/community-archive/obsidian-zotero-integration/issues/279#issuecomment-3435560391))
  (new).
- The supply side:
  - "I am really worried about the plugin accidentally messing up users'
    data" ([ZotFlow #73 comment](https://github.com/duanxianpi/zotflow/issues/73#issuecomment-4744136125));
  - Zotero's lead developer: update only "if the note had been edited and
    only offer this option if it hadn't"
    ([Zotero forum 99187](https://forums.zotero.org/discussion/99187)).

  (new)

- A secondhand worry about ZotLit frontmatter
  ([Discord](https://discord.com/channels/686053708261228577/1156633421922181201/1543519560924274708), 2026) (prior crawl).

**Signal: strong, about 20 voices.**

**Inference.** Trust is the gate on every other job. Users who once lost
writing stop writing in generated notes ("you have to guarantee that you'll
never add comments to the extracted markdown files",
[Reddit](https://www.reddit.com/r/ObsidianMD/comments/17vrbir/)) or stop
updating. Readwise is the trust benchmark: "Without this feature, I have to
keep using readwise reader" (omnivore#45, handoff).

### J10. When updates happen

**Asked, automatic:**

- ZI #216 (+11);
- "whenever I make changes to them within Zotero"
  ([Reddit](https://www.reddit.com/r/ObsidianMD/comments/1fvyvmv/));
- five "same here" replies on
  [Reddit](https://www.reddit.com/r/ObsidianMD/comments/11bhi22/autoupdate_note_when_zotero_highlights_change/);
- "sync automatically with some interval"
  ([ZotFlow #9](https://github.com/duanxianpi/zotflow/issues/9));
- "page only updates when forced command prompt update"
  ([ZotLit discussion #1404](https://github.com/aidenlx/zotlit/discussions/1404)).

(handoff, new)

**Asked, manual but quick:**

- "directly update the current note"
  ([ZI #104](https://github.com/community-archive/obsidian-zotero-integration/issues/104),
  +3);
- [ZI #199](https://github.com/community-archive/obsidian-zotero-integration/issues/199);
- "update whatever a given markdown file is 'connected' to"
  ([Reddit](https://www.reddit.com/r/ObsidianMD/comments/1fvyvmv/)).

(new)

**Costs of automatic:**

- re-rendering resets an embedded Base
  ([ZotLit discussion #993](https://github.com/aidenlx/zotlit/discussions/993));
- "Live updates cause the Pandoc engine to fail on startup"
  ([discussion #859](https://github.com/aidenlx/zotlit/discussions/859)).

(new)

**Counter-voices:**

- a one-way manual export is "enough"
  ([BN #45 comment](https://github.com/windingwind/zotero-better-notes/issues/45#issuecomment-1150478841))
  (new);
- "I never make changes in the auto-imported notes"
  ([Discord](https://discord.com/channels/686053708261228577/1156633421922181201/1429558962453483632))
  (prior crawl);
- "And then never use 'Resync all articles' again!"
  ([omnivore#45](https://github.com/omnivore-app/obsidian-omnivore/issues/45))
  (new).

**Signal: about 14 voices, split.**

**Inference.** Requests for "automatic" are about J1 and J2: users forget
the button after reading. For J4, J5 and J8 they ask for a quick manual
command. The answer depends on the job, not on the user.

### J11. References to a highlight keep working

**Asked.**

- A link to an annotation's `^70c086` anchor lost after re-import: "the
  internal link is removed"
  ([ZI #276](https://github.com/community-archive/obsidian-zotero-integration/issues/276)).
  "all other notes created in obsidian will also lose the reference"
  ([forum 36310/125](https://forum.obsidian.md/t/36310/125)) (handoff, new).
- "I create reading notes that link to specific annotations inside my
  literature notes, so I don't want to loose those backlinks"
  ([forum 102028](https://forum.obsidian.md/t/102028)) (prior crawl, new).
- "embedding feels like a much cleaner solution and offers the advantage of
  seeing which other notes links to the literature note"
  ([ZotLit #274](https://github.com/aidenlx/zotlit/issues/274), +2) (new).
- "I then embed/link each highlight in my other notes so I can follow an
  idea down to the source easily"
  ([Reddit r/GradSchool](https://www.reddit.com/r/GradSchool/comments/1wmmhmv/comment/pbby9fb/))
  (prior crawl). "Some of my concept notes I put direct block references
  back to the highlight"
  ([Reddit](https://www.reddit.com/r/ObsidianMD/comments/zlehy7/)) (new).
- Copying an embed into the daily note after each annotation
  ([ZotFlow #33](https://github.com/duanxianpi/zotflow/issues/33)) (prior
  crawl).

**Signal: moderate, about 8 voices**, plus the "reference, not a copy"
cluster I4 in
[the annotation-search report](https://github.com/aidenlx/zotlit/blob/research/annotation-search-user-needs/docs/research/annotation-search-user-needs.md).

**Re-examined under D1 and D2.** The literal ask is a `^id`. Underneath it,
the voices above ask for five things:

| Underlying need                                         | Voice                                | Served by the URI plus Citation Index?                                                                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Follow a thought back to the exact passage          | "follow an idea down to the source"  | **Yes**: click-to-open, with the page and the annotation                                                                                                                                                        |
| (b) See where a passage is used                         | ZotLit #274, forum 102028            | **Yes**, once D2 lands: backlinks per annotation                                                                                                                                                                |
| (c) The reference survives an update of the source note | ZI #276, forum 36310/125             | **Yes, and better than a `^id`**: the URI names the Zotero key, not a line in a file that re-renders                                                                                                            |
| (d) See the passage's text in the citing note           | ZotLit #274 "embedding", ZotFlow #33 | **Partly**: hover preview reads it live. Inline display without hovering needs a copy (the default insert writes the quote beside the URI) or a live embed. No voice asked for live inline display specifically |
| (e) Reach the passage on mobile or without ZotLit       | — (no direct voice)                  | **No**: the URI opens Zotero on desktop. A hover needs the plugin and the database. The link label stays readable                                                                                               |

**Inference.** D1 and D2 move "references to a highlight" from file
anchors to Zotero identity. Needs (a)–(c) are then met without a copy inside
the managed region. That removes the reason a copy in the literature note
had to keep stable ids. Need (d) is met where the user inserted a quote, not
in the region. No evidence found shows users need the literature note
itself to hold the copy they cite.

### Jobs at a glance

| Job                            | Voices | Owner of the content        | Typical ask                             |
| ------------------------------ | ------ | --------------------------- | --------------------------------------- |
| J1 New annotations             | ~22    | Zotero                      | "fetch new ones without me remembering" |
| J2 Edited annotations          | ~14    | Zotero                      | "fix it once, everywhere"               |
| J3 Deleted annotations         | ~9     | Zotero                      | remove or mark                          |
| J4 Metadata                    | ~18    | Zotero                      | frontmatter follows Zotero              |
| J5 Template change             | ~9     | Template                    | re-render old notes                     |
| J6 Thought by a highlight      | ~10    | User, inside generated list | keep my line under that quote           |
| J7 Own sections and properties | ~30    | User                        | never touch these                       |
| J8 Bulk                        | ~12    | —                           | all notes, scoped, safe                 |
| J9 Trust                       | ~20    | —                           | warn, no silent loss                    |
| J10 Auto or manual             | ~14    | —                           | depends on the job                      |
| J11 Stable references          | ~8     | User's links                | references survive updates              |

The handoff's mapping from literal ask to underlying need agrees:

| What users say                | What they need                                             |
| ----------------------------- | ---------------------------------------------------------- |
| "add persist" / "append-only" | what I write never disappears                              |
| "persist frontmatter"         | ownership per key                                          |
| "auto-update annotations"     | see the current state, not necessarily as text in the file |
| "sync Zotero notes"           | most: see the current content, read-only; a few: two-way   |
| "update all notes"            | template migration, with preview and undo                  |

## How each tool serves each job

### First-party mechanisms

| Tool               | Refresh semantics                                                                                                                                         | User content protection                                                                                                  | Typical failure                                                                          | Source                                                                                                                                                                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zotero Integration | Whole-file overwrite on every import                                                                                                                      | Opt-in `persist`: old content followed by the new render, so templates must filter by `isFirstImport` / `lastImportDate` | Silent loss, duplicates, footer drift                                                    | [Templating.md](https://github.com/community-archive/obsidian-zotero-integration/blob/main/docs/Templating.md), [source](https://github.com/community-archive/obsidian-zotero-integration/blob/2043211d87ff2ca5db31bf587b5024eac9f49171/src/bbt/template.env.ts#L148-L198) (handoff, new) |
| Citations          | Create only                                                                                                                                               | Never modifies                                                                                                           | Fixes never arrive                                                                       | [README](https://github.com/hans/obsidian-citation-plugin); "does not form a live link… creation of notes" ([#261](https://github.com/hans/obsidian-citation-plugin/issues/261#issuecomment-1884676576)) (handoff, new)                                                                   |
| Bibnotes           | Above "## Extracted Annotations" replaced; annotations matched by text, new ones inserted after the last match, removed ones kept                         | Matched annotations and their edits kept; "Select Section" mode                                                          | Character loss, corruption over updates                                                  | [README](https://github.com/stefanopagliari/bibnotes), [forum 29920/40](https://forum.obsidian.md/t/29920/40) (new)                                                                                                                                                                       |
| Readwise           | Append-only under a timestamped heading; optional 1/12/24 h auto-sync                                                                                     | "nothing in Obsidian will ever be overwritten"                                                                           | Edits and metadata never arrive; rename or move duplicates; reset is delete and reimport | [docs](https://docs.readwise.io/readwise/docs/exporting-highlights/obsidian) (handoff, new)                                                                                                                                                                                               |
| Readwise Mirror    | Regenerates the note from current data                                                                                                                    | Tracks files by a `uri` property; protects chosen frontmatter fields                                                     | —                                                                                        | [README](https://github.com/jsonMartin/readwise-mirror) (new)                                                                                                                                                                                                                             |
| Kindle             | Diff by a content hash per highlight; "bring in any new highlights without impacting any edits"                                                           | Existing lines untouched                                                                                                 | Template filters break the diff; mixed formats; duplicates                               | [README](https://github.com/hadynz/obsidian-kindle-plugin), [#101](https://github.com/hadynz/obsidian-kindle-plugin/issues/101), [#334](https://github.com/hadynz/obsidian-kindle-plugin/issues/334) (handoff, new)                                                                       |
| Hypothesis         | "Update existing articles with new highlights"; only when the source annotation changes                                                                   | "Reset sync… Does not delete any previously synced highlights"                                                           | Default template drops edits; duplicates                                                 | [README](https://github.com/weichenw/obsidian-hypothesis-plugin), [#55](https://github.com/weichenw/obsidian-hypothesis-plugin/issues/55), [#19](https://github.com/weichenw/obsidian-hypothesis-plugin/issues/19) (new)                                                                  |
| Omnivore           | Whole-file overwrite; later "sync only new articles"                                                                                                      | None; proposals: `omnivore_locked: true`, a protected bottom area                                                        | Local edits wiped                                                                        | [omnivore#45](https://github.com/omnivore-app/obsidian-omnivore/issues/45) (handoff, new)                                                                                                                                                                                                 |
| Logseq Zotero      | Appends on re-import, or overwrites with a setting                                                                                                        | None                                                                                                                     | Duplicate or full overwrite, one or the other                                            | [docs](https://github.com/logseq/docs/blob/master/pages/Zotero.md), [logseq#3442](https://github.com/logseq/logseq/issues/3442) (handoff, new)                                                                                                                                            |
| Better Notes       | Two-way sync of a Zotero note with a `.md`; the older side is updated; diff-merge on conflict                                                             | Hidden `bn` markers; `$`-prefixed YAML keys are BN's                                                                     | Escaped `[[`, cluttered HTML, blanked notes                                              | [README](https://github.com/windingwind/zotero-better-notes), [wiki](https://github.com/windingwind/zotero-better-notes/wiki/4.9-Note-Synchronization-Sycn.en), [discussion #244](https://github.com/windingwind/zotero-better-notes/discussions/244) (handoff, new)                      |
| ZotFlow            | Template part regenerated on item-version change; three zones (template, Zotero-synced regions, persist regions); `??` frontmatter fills only when absent | Malformed markers: "refuse[s] to update"; removed regions moved to an "Orphaned persist regions" section                 | Complexity; data-loss scares on template mistakes                                        | [source-notes.md](https://github.com/duanxianpi/zotflow-doc/blob/main/docs/source-notes.md), [concepts.md](https://github.com/duanxianpi/zotflow-doc/blob/main/docs/concepts.md) (handoff, new)                                                                                           |
| Dataview           | Renders at view time                                                                                                                                      | Writes nothing to the file                                                                                               | Not in links, graph or backlinks                                                         | [Dataview #465](https://github.com/blacksmithgu/obsidian-dataview/issues/465), [#2486](https://github.com/blacksmithgu/obsidian-dataview/issues/2486) (handoff)                                                                                                                           |
| PDF++              | Annotations are links into the PDF: "pure markdown"                                                                                                       | —                                                                                                                        | Highlights and back-navigation need the plugin                                           | [README](https://github.com/RyotaUshio/obsidian-pdf-plus), [discussion #208](https://github.com/RyotaUshio/obsidian-pdf-plus/discussions/208) (new)                                                                                                                                       |
| ZotLit v2          | Only the `zt-managed` region is replaced; metadata-only update; Overwrite keeps user frontmatter keys                                                     | Everything outside the region                                                                                            | Lost marker (#1274); v1 notes have no region                                             | [keep-notes-updated.mdx](https://github.com/aidenlx/zotlit/blob/next/apps/docs/content/docs/how-to/keep-notes-updated.mdx) (handoff, new)                                                                                                                                                 |

### Mechanism by job

Legend: ● serves the job, ◐ with caveats, ○ does not serve it, — not
applicable. Each cell is the author's reading of the docs and reports above.
The "durable link" column reflects D1 and D2.

| Job                       | Copy + full re-render (ZI default, Omnivore) | Copy + protected regions (ZI persist, ZotFlow, ZotLit v2) | Append-only (Readwise, Kindle, ZI date filter) | Live view (Query Block, Dataview) | Durable link (annotation URI + Citation Index) | Two-way sync (BN, ZotFlow regions) |
| ------------------------- | -------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------- | --------------------------------- | ---------------------------------------------- | ---------------------------------- |
| J1 New annotations        | ● on demand                                  | ● on demand                                               | ● on demand; dates fragile                     | ● no action                       | —                                              | ●                                  |
| J2 Edited annotations     | ●                                            | ● inside region                                           | ○                                              | ●                                 | ● hover shows current text                     | ◐ conflicts                        |
| J3 Deleted annotations    | ●                                            | ● inside region                                           | ○                                              | ●                                 | ◐ dangling link                                | ◐                                  |
| J4 Metadata               | ●                                            | ●                                                         | ◐                                              | ○ Bases and Dataview read files   | —                                              | ◐                                  |
| J5 Template change        | ●                                            | ◐ boundary can break                                      | ○ old notes stay                               | ●                                 | —                                              | ◐                                  |
| J6 Thought by a highlight | ○ lost                                       | ○ unless the thought is the Zotero comment                | ●                                              | ○ in the view                     | ● in the user's own note                       | ◐ comment regions                  |
| J7 Own sections           | ○                                            | ● if markers hold                                         | ●                                              | ●                                 | —                                              | ●                                  |
| J7 Own properties         | ○                                            | ◐ per key only                                            | ●                                              | ●                                 | —                                              | ◐                                  |
| J8 Bulk                   | ◐ risky                                      | ◐                                                         | ◐                                              | ● nothing to update               | —                                              | ◐                                  |
| J9 Trust                  | ○ silent overwrite                           | ◐ markers are visible syntax                              | ●                                              | ● nothing written                 | ● nothing written                              | ○ data-loss reports                |
| J10 Auto or manual        | manual                                       | manual                                                    | manual or scheduled                            | automatic                         | automatic                                      | automatic                          |
| J11 Stable references     | ○ ids lost                                   | ◐ ids regenerated                                         | ●                                              | ○ no block                        | ● (a)–(c)                                      | ◐                                  |

## Copy versus live view, after D1 and D2

A copy writes the annotation's text into the Markdown file. A live view stores
a query in the file and renders the annotations when the note is shown. A
durable link stores the annotation's identity. The v2 default moved the
literature note's Annotations section from a copy to a live view. With D1 and
D2, links settle part of what the copy was for.

**Settled by links (D1, D2).**

- Backlinks to one highlight, and "where is this used": the Citation Index
  over annotation URIs. That answers ZotLit #274's "seeing which other notes
  links to" and forum 102028's "don't want to loose those backlinks".
- Graph edges from a note to the highlights it cites. The Citation Index
  already extends the graph for citations (ADR 0029, `graph-citations`).
  _Inference_: annotation URIs would follow the same path. This is not yet
  built.
- References that survive a re-render (ZI #276).

**Not settled. Each item gives its evidence and its weight.**

| Gap                                       | What is missing                                                                                                                                                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Weight                                                                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Full-text search of highlight text        | Vault search finds text in files. Query output is rendered, not stored, so a highlight's words are findable only where a copy exists, such as an inserted quote or the link label | "I can only search the dataview-results when I'm in reading-mode" ([forum 94872](https://forum.obsidian.md/t/94872)); "obsidain offers more flexible ways to query highlights/notes/tags" as the reason to export ([Zotero forum 99187](https://forums.zotero.org/discussion/99187)) (new). ZotLit has its own annotation search, see the [annotation-search report](https://github.com/aidenlx/zotlit/blob/research/annotation-search-user-needs/docs/research/annotation-search-user-needs.md) S2                                      | Moderate. No voice in the sample complains about this for a Zotero live view yet; the Query Block default is nine days old |
| Writing a comment under one highlight     | A live view has no place to type beside one annotation. The Zotero comment is editable from Obsidian, but under S3 it is the only in-place home                                   | Bibnotes #13, #104 (+3), omnivore#45 "progressively process", forum 36310/317 (new, handoff). No voice asked to type into a live view (new)                                                                                                                                                                                                                                                                                                                                                                                              | Moderate to strong, J6                                                                                                     |
| Portability without the plugin            | Without ZotLit the fence is a code block. A URI link still shows its label, and opens Zotero if it is installed                                                                   | "my annotations are trapped; I want Markdown I own" as the switch story toward Obsidian (`other_software_annotation_models.md`, prior crawl); PDF++ users lose highlights when the plugin is off ([#208](https://github.com/RyotaUshio/obsidian-pdf-plus/discussions/208)); "less dependency = more reliability" ([Reddit](https://www.reddit.com/r/ObsidianMD/comments/zlehy7/)); copies in Obsidian saved a user whose Zotero references were lost ([Reddit](https://www.reddit.com/r/ObsidianMD/comments/1xbhwk8/), 2026-10-21) (new) | Moderate. Voices are about lock-in in general; none name a Zotero query block                                              |
| Frozen snapshots                          | A record of what the highlights were at a point in time                                                                                                                           | The handoff cites ZotLit #94, but #94 asks for a live embed (see spot-check). Dataview Publisher materialises query results between markers ([listing](https://www.obsidianstats.com/plugins/dataview-publisher), handoff). Print and export of a Query Block are a snapshot (`block.ts`)                                                                                                                                                                                                                                                | **Weak**: no Zotero user in the sample asks to freeze highlights                                                           |
| Frontmatter ownership by key              | User keys must survive while Zotero keys refresh. This is about the file, not about live views                                                                                    | ZI #475 (+4), #317, #60, #138, #351 comment, forum 97588, 36310/360, Reddit 1nikwi3, BN #527 (handoff, new)                                                                                                                                                                                                                                                                                                                                                                                                                              | **Strong**, J7. ZotLit v2 already merges per key (ADR 0052); what users want beyond that is not evidenced                  |
| Bases and Dataview over annotation fields | They read files, so they cannot see live annotations. ZotLit Query covers this inside ZotLit                                                                                      | Dataview as the escape hatch "read-only automated kanban" ([ZI #201 comment](https://github.com/community-archive/obsidian-zotero-integration/issues/201#issuecomment-2028498026)); a group wants "dataviews… a table of notes tagged 'researchquestion'" ([forum 48600](https://forum.obsidian.md/t/48600)) (new)                                                                                                                                                                                                                       | Weak to moderate                                                                                                           |
| Pandoc and other export                   | The fence exports as code                                                                                                                                                         | "not having transclusion on export is actually a huge limitation" ([forum 3193/4](https://forum.obsidian.md/t/3193/4)); [forum 46257](https://forum.obsidian.md/t/46257) (new)                                                                                                                                                                                                                                                                                                                                                           | Moderate, but about embeds in general                                                                                      |
| Mobile                                    | ZotLit is desktop-only, and phones lack the Zotero database. A Query Block shows as code; a URI does not open                                                                     | "I do most of my reading and writing on my iPad and iPhone" ([Reddit](https://www.reddit.com/r/ObsidianMD/comments/16qdmo1/)); "I study on my phone (Android)" ([forum 91637](https://forum.obsidian.md/t/91637)) (new); mobile reading in Zotero ([`reddit_feedback.md`](https://www.reddit.com/r/ObsidianMD/comments/1raotky/comment/o6w7qhn/), prior crawl)                                                                                                                                                                           | Moderate                                                                                                                   |
| Inline text of a cited highlight          | Hover shows it. Showing it inline needs an inserted copy                                                                                                                          | ZotLit #274 "embedding", ZotFlow #33 (new, prior crawl)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Weak to moderate                                                                                                           |

**Inference.** After D1 and D2, the literature note's copy of its own
annotations has lost its strongest reason to exist: the J11 references it
anchored. What still needs text in a file is search, mobile, export,
portability, and writing beside a quote. All of these are met where the
user puts a quote: the default insert writes the text, the citation and the
URI together. The evidence does not show that any of them need the copy to
sit inside the managed region.

## Zotero child notes: does anyone need the implicit import?

### What the code does (new)

- **The trigger.** The default template renders `## Notes` inside the
  managed region, with `{{ note.noteLink }}` for each `zt.notes` entry
  (`packages/templates/defaults/content.liquid`, since `732201dfd` on
  2026-07-02).
- **Rendering `noteLink` is what imports.** The first render of the link to
  a child note not yet imported queues that note. The flush then creates a
  Markdown file in the import folder. The code puts it as "an unrendered
  link imports nothing" (`resolveChildNote`, `buildNoteLink` and
  `flushQueue` in `apps/obsidian/src/services/note-import/service.ts`).
  The docs say the same: "When you create, update, or overwrite a
  literature note whose template or frontmatter references `noteLink`,
  ZotLit imports the child notes during that operation. No separate command
  is needed" (`apps/docs/content/docs/how-to/import-zotero-notes.mdx`).
  ADR 0001 calls imported notes "mirrors, not literature notes" (handoff).
- **Create once.** For a note already imported, `noteLink` links to the
  existing file and queues nothing. The docs: "Imported notes are created
  once and not automatically updated… Editing the Zotero note afterward
  does not change the imported file" (same doc, "Create-once behavior").
- **The only refresh is explicit and destructive.** That is "Update
  imported note from Zotero". Its modal reads: "Overwrite this file with
  the latest content from Zotero. Any local edits will be lost."
  (`modal_reimport_note_desc` in `messages/en.json`). The explicit imports
  are `command_import_child_notes_name` and `command_import_all_notes_name`.
- **No setting turns it off.** The `settings_note_import_*` keys cover the
  folder, highlight colour syntax and annotation rendering only. The
  `note.import-*` bindings are in
  `apps/obsidian/src/services/profile/bindings.ts`. Removing `## Notes`
  from the template is the switch.
- **Additions and deletions.** Because the list is inside the managed
  region, a child note added later in Zotero is imported on the next
  update. A trashed child note drops out of `zt.notes` (ADR 0071, 2026-10-14
  amendment).

  _Inference:_ its imported file stays in the vault. No cleanup path was
  found in the service.

- **What a live view could show.** A `ChildNote` carries `key`,
  `indexedKey`, `title` and `dateModified` (`packages/db/src/queries/notes.ts`).
  A Query View table can expand an item into its notes (ADR 0071), but
  there is no notes dataset (handoff). A live view today shows titles and
  dates, not bodies.

In short, the default behaviour has three parts. A child note's file is
created silently the first time the note is seen. The copy is frozen after
that. The only way to refresh it overwrites the whole file.

### Who imports child notes: the handoff's personas, merged

The frequency column is the handoff's qualitative judgement, not a count.
The evidence column merges the handoff with new items.

| Persona                                                                                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Frequency (handoff)   | What they need, as observed                                                                                         |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| P1. Writes a summary in Zotero's reader or note pane, then links and writes in Obsidian | "I often write a summary of the paper for myself inside Zotero's note panel" ([ZI #274](https://github.com/community-archive/obsidian-zotero-integration/issues/274)); [ZI #358](https://github.com/community-archive/obsidian-zotero-integration/issues/358); stale copies [ZI #406](https://github.com/community-archive/obsidian-zotero-integration/issues/406) (+2) and [ZI #414](https://github.com/community-archive/obsidian-zotero-integration/issues/414) (five "same"); [ZotLit #414](https://github.com/aidenlx/zotlit/issues/414); "import those sidebar Notes… also have the Obsidian version update" ([forum 62204](https://forum.obsidian.md/t/62204)); "I would like to import also the Notes (not the annotations…)" ([forum 119047](https://forum.obsidian.md/t/119047), 2026-10-05); "If I create a new note in zotero, it does not get pulled into obsidian" ([forum 98021](https://forum.obsidian.md/t/98021)) (handoff, new) | High                  | Mostly to see the current content in Obsidian, one-way and read-only. The few who want to edit on both sides use BN |
| P2. Uses "Add Note from Annotations" as a container                                     | [ZotLit discussion #127](https://github.com/aidenlx/zotlit/discussions/127) (two users); blogs where ZotLit made annotation notes unnecessary ([strova](https://a.strova.dk/blog/2022/08/22/my-academic-iPad/), [ntakahashi](https://ntakahashirad.netlify.app/en/articles/obsidian)); Zotero's lead developer: no one "should need to create intermediate notes in Zotero just for the purpose of transferring them out" ([forum 99187](https://forums.zotero.org/discussion/99187)) (handoff, new)                                                                                                                                                                                                                                                                                                                                                                                                                                               | Medium, mostly legacy | The annotations themselves; the note is a container. Query serves them                                              |
| P3. Legacy and migration, wants a one-time move into Obsidian                           | [BN #1198](https://github.com/windingwind/zotero-better-notes/issues/1198) ("export them all to Obsidian for management"); [ZI #201](https://github.com/community-archive/obsidian-zotero-integration/issues/201); "I want those notes as separate md in obsidian, with the images embedded, and the tags in the yaml" ([forum 48600](https://forum.obsidian.md/t/48600)) (handoff, new)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Medium                | A one-time, one-way migration; Obsidian is the source after that                                                    |
| P4. Atomic or many-note users                                                           | "I generally use many atomic notes" ([ZotLit #494](https://github.com/aidenlx/zotlit/issues/494)); [discussion #855](https://github.com/aidenlx/zotlit/discussions/855) (66,000+ items) (handoff)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Low to medium         | Choose which notes, one-way                                                                                         |
| P5. Child notes created by other plugins or automation                                  | [ZotLit discussion #944](https://github.com/aidenlx/zotlit/discussions/944) (handoff, verified)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Low, possibly growing | Read-only viewing, occasionally a copy                                                                              |
| P6. BN users and others who want two-way sync                                           | [ZotLit #424](https://github.com/aidenlx/zotlit/issues/424), [#238](https://github.com/aidenlx/zotlit/issues/238), [ZI #7](https://github.com/community-archive/obsidian-zotero-integration/issues/7) (+4); BN chosen to "edit the notes wherever, and not worry that anything is out of date" ([forum 62272](https://forum.obsidian.md/t/zotero-better-notes-plugin-syncs-notes-with-obsidian/62272), 27,943 views) (handoff, new)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Low to medium         | Real two-way sync, which conflicts with S2                                                                          |
| P7. Group-library collaborators                                                         | Gap filled (new): the clearest ask is a group that creates notes from annotations in Zotero and wants them exported "with tags + parent metadata", queried with Dataview ([forum 48600](https://forum.obsidian.md/t/48600)). Others ask for an annotation's author to "filter your own notes in group libraries" ([ZI #352](https://github.com/community-archive/obsidian-zotero-integration/issues/352)) and to hide students' annotations ([Zotero forum 132223](https://forums.zotero.org/discussion/132223)). Zotero locks each annotation to its creator ([Zotero forum 118345](https://forums.zotero.org/discussion/118345)); so does ZotLit ([#1266](https://github.com/aidenlx/zotlit/issues/1266)). No one in the sample asked for a collaborator's notes to appear or update in their own literature note                                                                                                                                | Low (new)             | Read-only, filtered by author; a one-time export at most                                                            |

### Against: copies that confuse, duplicate or go stale

- **Duplicated annotations.**
  - "duplicate highlights and comments"
    ([ZI #92](https://github.com/community-archive/obsidian-zotero-integration/issues/92));
  - "'Add note from annotations' option produces a note with the doubled
    annotations"
    ([ZI #161 comment](https://github.com/community-archive/obsidian-zotero-integration/issues/161#issuecomment-1379322351));
  - doubled comments
    ([ZotLit #299](https://github.com/aidenlx/zotlit/issues/299), v1).

  (handoff, new)

- **Stale or appended copies.**
  - "Every time you want to update a note, you have to delete it and re-add
    it" (ZI #406);
  - "the modified note is appended, which is quite annoying to clean up"
    ([forum 36310/216](https://forum.obsidian.md/t/36310/216));
  - Zotero's own copies of externally made notes "don't get updated until
    the file is opened in Zotero's editor again"
    ([ZI #241 comment](https://github.com/community-archive/obsidian-zotero-integration/issues/241#issuecomment-1637142937)).

  (new)

- **"Just another place."**
  - "until now it's just another way of storing notes"
    ([r/zotero](https://www.reddit.com/r/zotero/comments/1uz0f6l/), 2026,
    about ZotLit);
  - "the one directional dumping of zotero notes into obsidian is very
    limited"
    ([Reddit](https://www.reddit.com/r/ObsidianMD/comments/zlehy7/)).

  (new)

- **Workflow friction.**
  - "complicates the workflow… often rendering issues"
    ([ZotFlow #57 comment](https://github.com/duanxianpi/zotflow/issues/57#issuecomment-4702178716));
  - a NOTE region that appears only when a child note exists confused a
    user who does "not use that feature"
    ([ZotFlow #85](https://github.com/duanxianpi/zotflow/issues/85));
  - "I created a child note to store my own notes. Where does this file
    live?" and "I don't really want the item/child note to live in zotero"
    ([Reddit](https://www.reddit.com/r/ObsidianMD/comments/1tfke0n/)).

  (new)

- **Damage from two-way sync.**
  - escaped `[[`
    ([BN #1162](https://github.com/windingwind/zotero-better-notes/issues/1162),
    [#300](https://github.com/windingwind/zotero-better-notes/issues/300));
  - "complex html markup… super cluttered"
    ([forum 62272/2](https://forum.obsidian.md/t/62272/2));
  - notes overwritten
    ([BN #1388](https://github.com/windingwind/zotero-better-notes/issues/1388)).

  (handoff, new)

- **Link instead of note.**
  - "I don't want the note, just like the title and to have it linked so I
    can click on it and open it up in Zotero"
    ([Reddit](https://www.reddit.com/r/ObsidianMD/comments/w3xfb8/));
  - "hyperlinks from Obsidian to Zotero… sufficient for me"
    ([r/PhD](https://www.reddit.com/r/PhD/comments/1jn4djh/)).

  (new)

- **Effects of implicit import specific to ZotLit**, from the handoff
  (inference there; unconfirmed by user voices):
  - writing files as a side effect of rendering is not intuitive;
  - when editing the template, you cannot predict how many files it will
    create;
  - for users who do not write in Zotero it is mostly a no-op;
  - for users with legacy or plugin-made notes it makes a batch of files
    they never meant to maintain.

**Signal:** about 25 voices want child-note content in Obsidian, mostly P1
and P3. About 15 find copies stale, duplicated or unwanted. **No voice in
the sample, for or against, mentions ZotLit v2's implicit import by name.**
No one asked for a separate file per child note created without a command.
No one complained about getting one either.

### How other tools handle child notes

| Tool               | What happens to child notes                                                                                                                                                            | Trigger                                                                                  | Kept current?                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Zotero Integration | Copied into the literature note through the template (`notes`, `{{markdownNotes}}`), plus "Insert notes into current document" (#358, #237)                                            | Only if the template uses them                                                           | Re-rendered on import; edits often not detected (#406, #414)                                                        |
| Citations          | `{{note}}` from the BibTeX note field                                                                                                                                                  | Template, at creation                                                                    | No; stale from the start if notes are added later ([Reddit](https://www.reddit.com/r/ObsidianMD/comments/17vrbir/)) |
| Bibnotes           | `{{UserNotes}}` copied in ([#7](https://github.com/stefanopagliari/bibnotes/issues/7))                                                                                                 | Template                                                                                 | Per update mode                                                                                                     |
| Logseq             | Child items and notes included by a setting ([docs](https://github.com/logseq/docs/blob/master/pages/Zotero.md))                                                                       | Setting, on import                                                                       | Append or overwrite                                                                                                 |
| Better Notes       | The Zotero note is the source; `.md` export and two-way auto-sync                                                                                                                      | Explicit per note ("Set Auto-Sync"); the maintainer refuses whole-library export (#1198) | Yes, both ways                                                                                                      |
| ZotFlow            | Rendered in editable regions inside the source note, or a standalone editor; edits push back ([item-notes.md](https://github.com/duanxianpi/zotflow-doc/blob/main/docs/item-notes.md)) | Automatic when a child note exists                                                       | Yes, both ways                                                                                                      |
| ZotLit v2          | A separate mirror file per note, linked from the literature note                                                                                                                       | Implicit, by rendering `noteLink`; or the explicit import commands                       | No; explicit overwrite only                                                                                         |

**Inference.** In the sample, only ZotLit v2 makes a separate vault file for
each child note without a command. The other tools fall into two groups.
Some put the content inside the literature note through a template the user
wrote. The two-way tools sync a note only after the user sets it up.

### What each alternative would and would not cover

| Need (persona)                                              | Implicit create-once (today)          | Explicit import only                  | Link or list (title + `zotero://` link) | Live view of the note                |
| ----------------------------------------------------------- | ------------------------------------- | ------------------------------------- | --------------------------------------- | ------------------------------------ |
| Know child notes exist, from the lit note (P1, P5)          | ●                                     | ○ unless listed                       | ●                                       | ● titles today                       |
| Read the content in Obsidian (P1)                           | ● as of first sight                   | ● after a command                     | ◐ opens Zotero                          | ◐ needs a body renderer; none exists |
| Content stays current (P1, ZI #406, #414)                   | ○                                     | ○ (overwrite)                         | ●                                       | ●                                    |
| Search, graph, backlinks over the content (P3)              | ●                                     | ●                                     | ○                                       | ○                                    |
| Edit in Obsidian and keep the edits (P3)                    | ◐ until an explicit update overwrites | ● as a migration; ◐ if updated later  | —                                       | —                                    |
| Choose which notes (P4)                                     | ○ all of them                         | ● if the command lets you pick (#494) | ●                                       | ●                                    |
| Mobile and without the plugin                               | ●                                     | ●                                     | ◐ label only                            | ○                                    |
| No surprise files (P2, P5, users who don't write in Zotero) | ○                                     | ●                                     | ●                                       | ●                                    |
| Two-way (P6)                                                | ○                                     | ○                                     | ○                                       | ○ (outside S2)                       |
| Group collaborators (P7)                                    | ◐ imports others' notes too           | ●                                     | ●                                       | ● filtered by author possible        |

**Inference.** Removing the implicit import mainly costs P1 users who want to
read and search their Zotero summary in the vault without running a
command. Today they get a copy that goes stale, the very failure P1 voices
complain about (ZI #406, #414, ZotLit #414). Explicit import keeps P3's
migration and P4's choice for the cost of one step. A link or a live list
keeps discovery for P1 and P5, and it is the only option that cannot go
stale. None of the four options serves "written in Zotero, current and
searchable in Obsidian". Only two-way sync attempts that, and S2 rules it
out.

## What the needs imply for the managed region

These are constraints drawn from the evidence, not a design. Each cites the
job it comes from. "Must" means the evidence shows harm or strong demand.
"Need not" means the evidence does not ask for it, or D1, D2 or S1–S3
settle it.

**Must.**

1. Keep everything the user wrote outside generated content through every
   update. That includes updates started by mistake, in bulk, or after a
   template change (J7, J9, J5).
2. Keep user-owned frontmatter keys while refreshing Zotero-owned keys, key
   by key, without markers inside the YAML. Obsidian strips YAML comments
   (J7, J4; ZI #317).
3. Before a batch runs, show what it will touch (J8, J9).
4. Fail closed. If the boundary is damaged, change nothing rather than
   guess (J9; ZotFlow's "refuse to update"; ZotLit discussion #1274).
5. Change nothing when nothing changed (J9; ZI #279).
6. Keep metadata updatable without touching the body (J4; ZotLit #439,
   #477).
7. Scope bulk updates to existing notes (J8; ZotFlow #125, Bibnotes #11).
8. Leave a home for a thought about one highlight that survives updates
   (J6). The evidence names the Zotero comment, the user's own note with a
   quote and URI, a frozen copy, or a note per annotation. The managed
   region by itself provides none of these.

**Need not.**

1. Copy annotations into the region. J1–J3 are met by the live view, and
   J11 (a)–(c) by D1 and D2. Search, export, mobile and portability are met
   where the user inserts a quote (see the copy-versus-live table).
2. Keep stable `^id`s for annotations (D1).
3. Merge user text interleaved inside generated content. No tool does it,
   and Bibnotes' maintainer called it "not possible… line by line" (J6).
4. Update automatically for metadata and template changes. Users ask for a
   quick manual command there (J4, J5, J10).
5. Delete notes or files when Zotero deletes something. The few who asked
   split between delete and mark (J3).
6. Import child notes as files without a command. No voice asks for it.
   The users who want child-note content want it current, which a
   create-once copy is not (Child notes section).
7. Sync anything back to Zotero beyond what the comment editor already does
   (S2).

## Open questions

1. How do users split between writing beside highlights (J6) and writing in
   separate sections (J7)? The sample shows both, and nothing measures the
   split.
2. With annotations live, do users who need search, mobile or export find
   the inserted quote enough, or do they want a "freeze to text" for the
   literature note? No v2 user has reported on this yet; the Query Block
   default is nine days old.
3. Does anyone link or embed into the v2 managed region today, through
   `^id`s or headings, so that the D1 change breaks it? A vault-side count
   would answer this. User reports would not.
4. Will annotation URIs written before D2, such as a callout's page link,
   be indexed the same way as newly inserted ones? This is a build
   question, recorded because J11 (b) depends on it.
5. Do v2 users who get implicit child-note files read them, edit them, or
   only follow the link? Edits are lost on the explicit refresh.
6. For P1, is a live, read-only rendering of the child note's body in the
   literature note what they want? It is not available today, because
   there is no notes dataset.
7. Should the region's markers be visible syntax at all? Users have
   damaged them by accident (ZI #157, ZotLit discussion #1274), and others
   asked for the wrapping tags to be hidden
   ([ZotFlow #34](https://github.com/duanxianpi/zotflow/issues/34),
   prior crawl).
8. For group libraries, would a collaborator want others' annotations in
   their literature note's live view at all, or only their own? Only G1
   (ZI #352) speaks to this.
