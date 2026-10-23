# What researchers need from annotation search and insert

Source study, 2026-10-23. It looks at what academic researchers need when,
while writing in a note or draft, they search their PDF annotations and insert
one at the cursor. It treats two axes separately: how they **search** for an
annotation, and **what gets inserted**. This report records source
observations. It recommends no design. It gives need clusters, their evidence,
the tensions between them, and open questions for a later design discussion.

A companion page, `annotation-search-user-needs.html` in this folder, explains
the same findings with diagrams. This Markdown file is the citable source.

Context only: the Annotation Suggester shipped in PR #1626 (ticket
[#1625](https://github.com/aidenlx/zotlit/issues/1625), spec
[#1621](https://github.com/aidenlx/zotlit/issues/1621)). `[>` opens a search
in which words match highlight text and comment, `tag:`, `color:` and `paper:`
narrow, results order by recent paper activity, and the choice is inserted
through the annotation template (default: a callout with quote,
`[@key, {p. N}]`, comment and a durable `zotero://` link). The clusters below
are not organised around that design.

## Sources and method

**Built on prior research.** The maintainer's report *Make each Zotero
annotation an Obsidian object* (2026-10-04) and its eight supporting notes
(*Obsidian PDF annotation integration*) are in the notes repo at
`~/aidenlx-repo/notes/agents/reports/` and `.../agents/research_notes/`. They
include a Reddit crawl (32 threads, nine communities) and a Discord crawl
(five channels of the Obsidian Members Group). This study reuses that
evidence. Reddit and Discord items below marked *(prior crawl)* are cited from
`reddit_feedback.md` and `discord_feedback.md`. They were not reopened. The
prior work covers the insert axis at the level of tools and workflows. It
barely covers the search axis, so most new collection went there.

**New collection, 2026-10-23:**

- GitHub, through `gh`: all non-maintainer issues (337) and discussions (121)
  of `aidenlx/zotlit`, including the v1 era. Issues of
  `community-archive/obsidian-zotero-integration` (moved from `mgmeyers/`),
  `hans/obsidian-citation-plugin`, `duanxianpi/zotflow`, and
  `RyotaUshio/obsidian-pdf-plus` (issues and discussions).
  `windingwind/zotero-better-notes` (issues and discussions). `logseq/logseq`.
  `aidenlx/obsidian-zotero` redirects to `aidenlx/zotlit`.
- Zotero forums and Zotero documentation: the word-processor "Add Annotation"
  threads, annotation-search and colour threads, note templates, and Quick
  Copy.
- Obsidian forum, Logseq forum, Zettelkasten forum, and the Obsidian plugin
  directory (for small plugins that already search or insert annotations).
- First-party docs: Pandoc manual (citation syntax), CSL 1.0.2 specification
  (locators), Zotero `pdf_reader`, `note_templates` and
  `word_processor_plugin_usage`, Zotero 9 and 10 release posts, PDF++ README,
  Readwise Obsidian export and Reader filter syntax, Hypothesis search help,
  Citavi 6 Word Add-In manual.

**Method and limits.** Two sub-agents swept the Zotero forums and the GitHub
repositories, and the author spot-checked their key items (Better Notes
discussion 1129, Citation plugin #46, PDF++ discussion 444, Zotero forum
thread 133311). Forum pages were read through a fetch tool that summarises.
Some quotes may be lightly trimmed, and items marked *paraphrase* are not
verbatim. Reaction counts are small everywhere: the highest seen is 69 upvotes
on a Better Notes template discussion and 12 on an issue. Thus **signal
strength means the number of independent voices across sources**, not votes.
The voice counts are approximate.

**Not reached or thin:** Reddit and Discord were not re-crawled. The Obsidian
forum search found only a few on-topic threads. Bookends, Highlights,
LiquidText and MarginNote have no first-party doc reached on this question.
They appear only through prior notes or community posts. The Zotero "Add
Annotation" dialog has no support page beyond the
[Zotero 9 post](https://www.zotero.org/blog/zotero-9/) and its forum
announcement. No source measures how often researchers search annotations
while writing.

## Search needs

Each cluster has three parts: what users ask (with links), its rough signal,
and *inference*, which is the author's reading and is labelled as such.

### S1. Find the paper first, by author and year

**Asked.** Users remember a source by author and year, not by title, and they
want one search box that accepts any mix of these fields:

- "very often remember the author and the year of publication"
  ([Citation #232](https://github.com/hans/obsidian-citation-plugin/issues/232),
  2023, 3 reactions).
- "I usually remember articles by author and year, never by title"
  ([Citation #220](https://github.com/hans/obsidian-citation-plugin/issues/220),
  2023).
- "not possible to combine title, author, publication year"
  ([ZotFlow #46](https://github.com/duanxianpi/zotflow/issues/46), 2026).
- Search by citekey, with a proposed field syntax `author:… bibkey:… title:…`
  ([Citation #46](https://github.com/hans/obsidian-citation-plugin/issues/46),
  2021, 12 reactions, the most-reacted on-topic item found).
- The same request for ZotLit
  ([#326](https://github.com/aidenlx/zotlit/issues/326), 2024–2025, three
  voices). v2 now matches citekeys.

Diacritics must fold ("Lammermann" matches "Lämmermann";
[ZotFlow #110](https://github.com/duanxianpi/zotflow/issues/110),
Citation #232). Same-author, same-year items need more columns to tell them
apart ([ZI #46](https://github.com/community-archive/obsidian-zotero-integration/issues/46)).

One user asked exactly the annotation version of this: "Using the Zotero
search bar i only find the title, not the referenced annotations with the page
number"
([Obsidian forum](https://forum.obsidian.md/t/obsidian-zotero-citation-how-to-show-citation-next-to-text-beginner-user-problem/65249),
2023-08, no replies).

**Signal: strong, about 12 voices.** Most of them are about item search, not
annotation search.

**Inference.** For annotation search, the paper is often the first key the
writer has in mind. Today `paper:` matches only a title substring or an exact
citekey, not authors (#1625 open points). That is a current-state fact. It is
not a finding about users.

### S2. Words of the passage or the comment

**Asked.**

- "Now I can achieve block-quoting by searching for the annotations." A v1
  user describes search-then-insert, then asks that drag also give a
  reference, not a copy
  ([ZotLit #211](https://github.com/aidenlx/zotlit/issues/211), 2023).
- "it can be really hard to find a annotation sometimes"
  ([ZotLit #443](https://github.com/aidenlx/zotlit/issues/443), 2025). The
  maintainer added a sidebar search over text, comment, tags and page in v2.
- Annotations should be findable from the global search bar
  ([Zotero forum 90105](https://forums.zotero.org/discussion/90105/visualized-and-searchable-annotations),
  2023, two users).
- Show the match in context, without opening each attachment
  ([Zotero forum, santj139](https://forums.zotero.org/discussion/comment/516451),
  2026, *snippet only*).
- Contrary preference: "I never found tagging to be useful - full text search
  worked well enough"
  ([Reddit](https://www.reddit.com/r/AskAcademia/comments/1mivhfy/comment/n76mgl5/),
  2025, +7, *prior crawl*).

Zotero's own insert dialog makes text the default narrowing. Its filter is
"really just filtering by words in the annotations"
([joycekwc](https://forums.zotero.org/discussion/comment/515148/), 2026). The
small Obsidian plugin
[Zotero Completion](https://community.obsidian.md/plugins/zotero-completion)
matches "comment or highlighted text" and nothing more.

**Signal: moderate, about 6 voices.** The need is mostly implied by product
defaults, not stated.

**Inference.** Text search finds a passage the writer half-remembers. It does
not help the writer browse candidates for a claim. That job is S3 and S4.

### S3. Tags as concept codes across papers

**Asked.** This is the most-repeated cross-paper retrieval request:

- "I would really like to see tags receiving the ability to list ALL the
  tagged lines/passages from PDFs" (SteffenHe), and "I would love to be able
  to search for a tag, filter for annotations only" (wang_sophia, for
  literature reviews), in the
  [Zotero forum thread 114531](https://forums.zotero.org/discussion/comment/481136),
  2024–2025, about five users.
- In the Word insert dialog: "I don't see a way for example to filter by tag
  (which I'd love)"
  ([joycekwc](https://forums.zotero.org/discussion/comment/515148/), 2026-07).
- Better Notes "Generate note from annotations (by tag/color)":
  [discussion 1129](https://github.com/windingwind/zotero-better-notes/discussions/1129),
  69 upvotes, 47 comments. Related: "all annotation in one note with heading1
  the tag and heading2 the source"
  ([1305](https://github.com/windingwind/zotero-better-notes/discussions/1305)),
  a tag-driven "master note"
  ([342](https://github.com/windingwind/zotero-better-notes/discussions/342)),
  and "locate and collect annotations associated with a particular tag"
  ([1184](https://github.com/windingwind/zotero-better-notes/discussions/1184)).
- Import only annotations with a given tag, because "the truly important
  content that needs to be cited is a small part"
  ([ZotLit #210](https://github.com/aidenlx/zotlit/issues/210), 2023). Also
  [ZI #347](https://github.com/community-archive/obsidian-zotero-integration/issues/347).
- "extract those passages by tag where each passage is cited and links back to
  its source"
  ([Reddit r/AskAcademia](https://www.reddit.com/r/AskAcademia/comments/1baf9y9/struggling_with_reading_priorities_and_annotation/),
  2024, *prior crawl*).
- Tag-based grouping in place of colour
  ([Discord, 2025-11-05](https://discord.com/channels/686053708261228577/1156633421922181201/1435363950865678478),
  *prior crawl*).

Counter-voices: "basically every quote has the same tag" in a focused book
([Reddit](https://www.reddit.com/r/AskAcademia/comments/1mivhfy/how_do_you_read_and_highlight_long_texts/),
*prior crawl*), and the full-text preference in S2.

**Signal: strong, more than 15 voices** across Zotero, Better Notes, ZotLit,
Zotero Integration and Reddit.

**Inference.** In most of these voices the tag is a code for a theme or a
section of the writer's own text, used *across* papers. The output they
describe is a collection, so this need sits between search-and-insert and the
Query Blocks of 2.2.

### S4. Colour, and what the colour means

**Asked.**

- Search by colour across the library: at least eight users in four Zotero
  threads, 2023–2026. "I'd also like to search by color in full collections,
  not individual PDFs"
  ([rdiaz02](https://forums.zotero.org/discussion/120650/feature-request-add-a-way-to-search-pdf-annotations-by-color),
  2026). "the colors have different meanings"
  ([patrickaurich](https://forums.zotero.org/discussion/131506/create-notes-from-annotations-based-on-colors),
  2026). See also
  [108494](https://forums.zotero.org/discussion/108494/search-annotations-by-highlight-color)
  and [110131](https://forums.zotero.org/discussion/110131/extract-annotations-by-color).
  Zotero 10 added an "Annotation Color" search condition
  ([blog](https://www.zotero.org/blog/zotero-10/)).
- Name the colours:
  [Zotero forum 103437](https://forums.zotero.org/discussion/103437/feature-request-labelling-the-highlight-text-colours)
  has about 26 distinct users, 2023–2024, and no staff change. One user wants
  "a way to name colors and have them be available to search or filter"
  (kdb_research, in 108494).
- One PDF++ user wants to "pull up all such orange annotations", where orange
  means questions
  ([PDF++ discussion 461](https://github.com/RyotaUshio/obsidian-pdf-plus/discussions/461)).

What the colours mean differs per user:

- Importance (minor and major; notes and important): forum 103437.
- Argument role: "blue = definition, magenta = minority opinion, green =
  prevailing opinion" (cbischof in 103437). "red highlights for things I
  disagree with" ([Reddit](https://www.reddit.com/r/AskAcademia/comments/1wvu3k2/comment/pdflwcg/),
  *prior crawl*).
- Paper section: "research gap, materials and methods, prerequisite theory,
  results and conclusions"
  ([Reddit](https://www.reddit.com/r/GradSchool/comments/1wmmhmv/comment/pb82vos/),
  +36, *prior crawl*). Purpose, content and innovation
  ([BN 1358](https://github.com/windingwind/zotero-better-notes/discussions/1358),
  19 upvotes).
- Excerpt type, not a topic: "Annotation colors are used to assign semantic
  meaning (e.g., section headers, quotes, personal notes), not to cluster
  content"
  ([BN 1557](https://github.com/windingwind/zotero-better-notes/discussions/1557)).
  Colour as a heading marker
  ([ZotLit discussion 434](https://github.com/aidenlx/zotlit/discussions/434)).
- No colour at all: "I don't color-code my highlights"
  ([Discord](https://discord.com/channels/686053708261228577/1156633421922181201/1431035340524879972),
  *prior crawl*).

**Signal: strong, more than 30 voices** for colour carrying meaning. About 10
ask to *search* by it.

**Inference.** A user does not think of a colour as "yellow". They think
"definition" or "disagree". A filter or a result row that speaks in hex or
colour names asks the user to translate. Named colours are deferred in
[#1620](https://github.com/aidenlx/zotlit/issues/1620).

### S5. Narrow the scope: collection, this note's sources, one paper

**Asked.**

- Limit the search to a collection
  ([ZI #64](https://github.com/community-archive/obsidian-zotero-integration/issues/64),
  2022; [ZotFlow #45](https://github.com/duanxianpi/zotflow/issues/45), 2026).
  "Most people use mainly tags to organize papers"
  ([ZotFlow #83](https://github.com/duanxianpi/zotflow/issues/83)).
- "limit search to selected parent items only" (SteffenHe,
  [Zotero beta thread 123884](https://forums.zotero.org/discussion/123884/available-for-beta-testing-annotations-in-the-items-list),
  2025).
- Citations already in the current document should come first
  ([ZotLit #342](https://github.com/aidenlx/zotlit/issues/342), 2024).
- The plugin
  [Zotero Annotations](https://community.obsidian.md/plugins/zotero-annotations)
  (bpiwowar) scopes its sidebar to the paper under the cursor and lists "the
  papers a note cites". It is a built example of scoping by the note's own
  sources, not a request.

**Signal: moderate, about 6 voices.**

**Inference.** When drafting, the candidate set is often small and known: the
papers this chapter already cites, or one collection. The writer may want
that scope without typing it.

### S6. Annotation type, and "has a comment"

**Asked.**

- Filter to annotations that have comments (sojusnik,
  [Zotero forum](https://forums.zotero.org/discussion/comment/460853), 2024,
  plus one +1). Comments only, not highlights
  ([BN 1474](https://github.com/windingwind/zotero-better-notes/discussions/1474)).
- Filter by type, for example underlines (documut, in forum 90105). Zotero
  staff say it is planned.
- Image excerpts drop out of colour and tag collectors
  ([BN #1098](https://github.com/windingwind/zotero-better-notes/issues/1098)).
  A user wants codes on image regions that OCR cannot read
  ([Discord](https://discord.com/channels/686053708261228577/1156633421922181201/1516159842639941763),
  *prior crawl*).

**Signal: weak to moderate, about 5 voices.**

**Inference.** "Has a comment" is a proxy for "I already thought about this
one". That is a different kind of narrowing from type.

### S7. Order: recency, reading order, or relevance

**Asked.**

- Recency, but for *citations*: "latest used"
  ([Citation #66](https://github.com/hans/obsidian-citation-plugin/issues/66))
  and "recently-cited" ([ZotLit #342](https://github.com/aidenlx/zotlit/issues/342),
  [discussion 513](https://github.com/aidenlx/zotlit/discussions/513)).
- Page order within a paper, many times:
  [ZotLit #72](https://github.com/aidenlx/zotlit/issues/72) and
  [#95](https://github.com/aidenlx/zotlit/issues/95),
  [ZotFlow #7](https://github.com/duanxianpi/zotflow/issues/7),
  [PDF++ #24](https://github.com/RyotaUshio/obsidian-pdf-plus/issues/24), and
  [ZI #412](https://github.com/community-archive/obsidian-zotero-integration/issues/412)
  (title only).
- Manual order when page order is wrong
  ([ZotFlow #51](https://github.com/duanxianpi/zotflow/issues/51)).
- The paper's headings with highlights below
  ([Discord, 2026-09-02](https://discord.com/channels/686053708261228577/722584061087842365/1544687101403070544),
  *prior crawl*).
- Sort by update date
  ([BN 1288](https://github.com/windingwind/zotero-better-notes/discussions/1288)).

**Signal: moderate.** Reading order within a paper is well supported. No user
asked for recency ordering of *annotations* across papers.

### S8. Typed syntax, plain words, or pickers

**Asked.** There is little direct evidence.

- One strong voice for field syntax (Citation #46: `author:` `bibkey:`
  `title:`).
- Zotero Integration users who could not narrow by text were sent to Zotero's
  **classic picker**, which has a collection tree and more columns
  ([ZI #64](https://github.com/community-archive/obsidian-zotero-integration/issues/64),
  [#46](https://github.com/community-archive/obsidian-zotero-integration/issues/46)).
  They also asked for search inside Obsidian rather than a separate Zotero
  window ([ZI #85](https://github.com/community-archive/obsidian-zotero-integration/issues/85)).
- Zotero 10 answers with an Advanced Search condition builder (type, colour,
  author, tag, text, comment, with nesting), not a quick filter. Beta users ask
  to *hide* non-matches rather than grey them out (three voices in
  [thread 123884](https://forums.zotero.org/discussion/123884/available-for-beta-testing-annotations-in-the-items-list)).
- ZotFlow added a tag parameter to its search bar, and fuzzy tag matching
  ("scwr" matching "scientific-writing";
  [ZotFlow #95](https://github.com/duanxianpi/zotflow/issues/95)).
- Prior art with typed prefixes: Hypothesis `tag:`, `user:` and `url:`
  ([help](https://web.hypothes.is/help/how-hypothesis-search-works/)), and the
  Readwise Reader filter language (`tag:`, `author:`;
  [guide](https://docs.readwise.io/reader/guides/filtering/syntax-guide)).
- Many ZotLit users find template syntax hard: "learning how to use it and
  LiquidJS is too much for my tired brain"
  ([Discord](https://discord.com/channels/686053708261228577/1156633421922181201/1549740838874251294),
  *prior crawl*). That concerns templates, not search.

**Signal: weak.** No user was found who tried an inline `tag:` token in an
editor suggester and reported on it.

### Gap: page as a search key

No user asked to find an annotation by its page number. The ZotLit sidebar
search matches page labels (maintainer reply on #443), but there is no voice
for or against it.

## Insert-form needs

The clusters are grouped by the form that gets inserted. Each one names the
workflow that the evidence ties it to.

### I1. Pinpoint citation only: citation plus page, no quote (drafting)

**Asked.**

- "I do not want Zotero to add to my body text." The user wants only the
  footnote reference for an annotation (FelixBodeHH, coming from Citavi,
  [Zotero forum 133311](https://forums.zotero.org/discussion/133311),
  2026-08).
- "Many of us primarily want the pinpoint reference" (justanotherjurastudent,
  same thread, 2026-09). They wrote the Zotero plugin FlexAnnotations to get
  it, and FelixBodeHH said it "solves many of my problems".
- "insert just the reference (eg. Heylen et al. (2015) p.2)"
  ([Obsidian forum](https://forum.obsidian.md/t/obsidian-zotero-citation-how-to-show-citation-next-to-text-beginner-user-problem/65249),
  2023).
- Turn "Page 1" into "(Zhang et al., 2014, p. 1)"
  ([ZotLit #143](https://github.com/aidenlx/zotlit/issues/143), with a 2023
  "bump"; [#141](https://github.com/aidenlx/zotlit/issues/141)).
- "I only need (Author Page#)" under MLA
  ([ZI #3](https://github.com/community-archive/obsidian-zotero-integration/issues/3)).
- Citekey plus page in place of Zotero's author-date: realtime99, sutzig,
  unifields and vivko
  ([forum](https://forums.zotero.org/discussion/comment/473032), 2022–2024),
  Sh_Ism ([forum](https://forums.zotero.org/discussion/comment/496117), 2025),
  and `[NEU, p.130]`
  ([PDF++ discussion 199](https://github.com/RyotaUshio/obsidian-pdf-plus/discussions/199)).
- "Never took any notes from a paper I use the write as you go approach and I
  write and cite directly"
  ([Reddit r/PhD](https://www.reddit.com/r/PhD/comments/1jn4djh/comment/mkhgusu/),
  +24, *prior crawl*).

The page label must be the printed page, not the PDF index:

- "17/309" when the book page is 2
  ([ZotLit discussion 1199](https://github.com/aidenlx/zotlit/discussions/1199)).
- "the annotation on page 63 will show up as page 1"
  ([PDF++ #524](https://github.com/RyotaUshio/obsidian-pdf-plus/issues/524)).
- Page labels are ignored
  ([ZI #372](https://github.com/community-archive/obsidian-zotero-integration/issues/372),
  four or more users).
- Roman-numeral front matter
  ([ZI #97](https://github.com/community-archive/obsidian-zotero-integration/issues/97)).

About 15 voices on page labels.

**Zotero's position.** "The whole point of adding an annotation or a note is
to insert the full contents". To cite only the item, use Add/Edit Citation,
and "a future version will offer the current page number when citing an open
document" (dstillman, thread 133311, *paraphrase of the second half*).

**Locator conventions.** Pandoc reads a locator after the key
(`[@smith04, p. 33]`, `pp. 33-35`, `chap. 1`) and recognises the CSL locale
terms (book, chapter, column, figure, folio, line, note, page, paragraph,
part, section, sub verbo, verse, volume, `¶`, `§`). "If no locator term is
used, 'page' is assumed." Braces force a locator such as
`{pp. iv, vi-xi, (xv)-(xvii)}`. Pandoc also has `[-@key]` (suppress author)
and `@key [p. 33]` (author in text)
([Pandoc manual, Citation syntax](https://pandoc.org/MANUAL.html#citation-syntax)).
CSL defines `locator` as "a cite-specific pinpointer within the item (e.g. a
page number within a book, or a volume in a multi-volume work)"
([CSL 1.0.2](https://docs.citationstyles.org/en/stable/specification.html)).
The Zotero Word plugin takes a typed locator ("p.34", "34", ":45-48") in the
citation search
([docs](https://www.zotero.org/support/word_processor_plugin_usage)). The
Citavi Word Add-In asks for a bare page range ("14-15", not "pp. 14-15";
[manual](https://www1.citavi.com/sub/manual6/en/101_creating_a_publication_with_word.html)).

**Signal: strong, about 10 voices** for citation-only, plus about 15 for
correct page labels.

**Inference.** For a writer who paraphrases, the annotation is a bookmark that
supplies the page. The quote text is not wanted in the draft. Some of these
users also want the author suppressed or in text, but no source says how
often.

### I2. Run-in quote with citation, ready for prose (drafting, review tables)

**Asked.**

- Logseq "Copy text with reference" (text, block ref, citekey and page):
  eight distinct users, 2022–2024
  ([Logseq forum](https://discuss.logseq.com/t/pdf-annotation-copy-text-with-block-ref-citekey-and-page-number/9149)).
- A note that holds "Quotation" then "Ref. Author 2010, p.23-24"
  ([BN discussion 758](https://github.com/windingwind/zotero-better-notes/discussions/758)).
- Get quotes in citation format back into notes
  ([BN 551](https://github.com/windingwind/zotero-better-notes/discussions/551)).
- An Actions & Tags script that combines text, comment, Pandoc citation and a
  Zotero link
  ([Discord](https://discord.com/channels/686053708261228577/1156633421922181201/1518005935149289482),
  *prior crawl*).
- A synthesis spreadsheet column "Quote … with page numbers"
  ([Pacheco-Vega](https://www.raulpacheco.org/2016/06/synthesizing-different-bodies-of-work-in-your-literature-review-the-conceptual-synthesis-excel-dump-technique/),
  *prior notes*).

Built examples:

- The plugin
  [PDF Scholia Scribe](https://community.obsidian.md/plugins/pdf-scholia-scribe)
  (a PDF++ fork, about 2,000 downloads) inserts
  `"quoted passage" (Author year:page)` with the link under the citation. It
  also offers quote-block and callout forms.
- Zotero's default note form is `{{highlight}} {{citation}} {{comment}}`, and
  "Quotation marks are automatically added around the highlight"
  ([note templates](https://www.zotero.org/support/note_templates)).

**Signal: moderate to strong, about 12 voices.**

### I3. Full annotation block: quote, comment, page link, image (literature and topic notes)

**Asked.**

- ZotLit users drag annotations from several papers onto "summary pages of a
  topic" ([#294](https://github.com/aidenlx/zotlit/issues/294)).
- They want the source shown on each block when it comes from many books
  ([#369](https://github.com/aidenlx/zotlit/issues/369),
  [discussion 173](https://github.com/aidenlx/zotlit/discussions/173)).
- Colour-coded callouts embedded in other notes
  ([Reddit r/GradSchool](https://www.reddit.com/r/GradSchool/comments/1wmmhmv/comment/pbby9fb/),
  *prior crawl*).
- Order of parts inside the block:
  - "it is often more helpful to have the text above, not below, the note"
    ([BN #1602](https://github.com/windingwind/zotero-better-notes/issues/1602)).
  - The comment in a new paragraph
    ([BN 972](https://github.com/windingwind/zotero-better-notes/discussions/972)).
  - "Go to annotation" before the quote is unwanted
    ([ZI #164](https://github.com/community-archive/obsidian-zotero-integration/issues/164),
    [#185](https://github.com/community-archive/obsidian-zotero-integration/issues/185)).
- Print the colour's meaning in the block, because "I am both colour blind and
  forgetful"
  ([PDF++ #357](https://github.com/RyotaUshio/obsidian-pdf-plus/issues/357)).
  Use a colour emoji
  ([PDF++ discussion 209](https://github.com/RyotaUshio/obsidian-pdf-plus/discussions/209)).
- Image excerpts need a clean output form:
  [PDF++ #106](https://github.com/RyotaUshio/obsidian-pdf-plus/issues/106)
  (pinned), [#359](https://github.com/RyotaUshio/obsidian-pdf-plus/issues/359),
  and [#566](https://github.com/RyotaUshio/obsidian-pdf-plus/issues/566). In
  Zotero's Word insert, "Image and ink annotations are inserted as images"
  ([Zotero 9](https://www.zotero.org/blog/zotero-9/)).
- Zotero's own design: the full annotation, with comment and citation, is the
  intended insert (thread 133311 above). A text-only annotation without a
  citation was treated as a bug
  ([thread 510892](https://forums.zotero.org/discussion/comment/510892/)).

**Signal: moderate, about 10 voices.** They come from note-building, not
draft-writing.

### I4. A reference, not a copy: link or embed (Zettelkasten, daily and topic notes)

**Asked.**

- "it doesn't really make sense to have a bunch of copies of the same
  highlight … embedding feels like a much cleaner solution and offers the
  advantage of seeing which other notes links"
  ([ZotLit #274](https://github.com/aidenlx/zotlit/issues/274), 2 reactions).
  Duplicate: [#211](https://github.com/aidenlx/zotlit/issues/211).
- How to update annotations that were dragged into non-literature notes
  ([#294](https://github.com/aidenlx/zotlit/issues/294)). This is the
  copy-drift problem.
- "copying the embed to reference it in my daily journal note" after each
  highlight ([ZotFlow #33](https://github.com/duanxianpi/zotflow/issues/33)).
- Links from notes to specific highlights: "That's all I need"
  ([Discord, 2026-06-20](https://discord.com/channels/686053708261228577/1156633421922181201/1517843814574723094),
  *prior crawl*).
- "I then embed/link each highlight in my other notes so I can follow an idea
  down to the source"
  ([Reddit](https://www.reddit.com/r/GradSchool/comments/1wmmhmv/comment/pbby9fb/),
  *prior crawl*).
- Text that is "just the text selected but hyperlinked to the location"
  ([PDF++ discussion 540](https://github.com/RyotaUshio/obsidian-pdf-plus/discussions/540)).
- Copy a link from an already-highlighted passage, because "I need to
  cite/annotate the same content in different Markdown note"
  ([PDF++ #384](https://github.com/RyotaUshio/obsidian-pdf-plus/issues/384)).
- Built example:
  [Zotero Completion](https://community.obsidian.md/plugins/zotero-completion)
  inserts only a `zotero://open-pdf` link with the page.

**Signal: moderate, about 8 voices.**

**Inference.** Permanent notes in the Ahrens method need the writer's own
words plus a pointer to the source. A link without the quote fits that. This
comes from method literature (prior notes), not from a direct request.

### I5. Plain text with no link or citation, or a link on the citation only

**Asked.**

- "I don't need those links to orginal PDF"
  ([PDF++ discussion 160](https://github.com/RyotaUshio/obsidian-pdf-plus/discussions/160)).
- A toggle for "only the text … without the citation"
  ([BN 1232](https://github.com/windingwind/zotero-better-notes/discussions/1232)).
- A link "only for the citation", not on the quote
  ([BN 848](https://github.com/windingwind/zotero-better-notes/discussions/848),
  4 upvotes).
- "Having the highlight + page + citekey in all of the highlights seems a bit
  superfluous" (andupaz,
  [Logseq forum](https://discuss.logseq.com/t/pdf-annotation-copy-text-with-block-ref-citekey-and-page-number/9149)).
- Quoted PDF text must not be parsed as Markdown:
  [PDF++ #525](https://github.com/RyotaUshio/obsidian-pdf-plus/issues/525),
  [#526](https://github.com/RyotaUshio/obsidian-pdf-plus/issues/526), and
  [Logseq #8463](https://github.com/logseq/logseq/issues/8463).

**Signal: moderate, about 6 voices.**

**Gap.** No user asked for a *paraphrase scaffold*, such as the citation and
page with an empty slot for the writer's own words. Citavi's typed knowledge
items (direct quote, indirect quote, summary, comment) are the nearest prior
art (*prior notes*). The need is inferred, not asked.

### I6. Several annotations at once (literature notes, review collections)

**Asked.**

- "an easy way to export all my notations for a document" in the Word insert.
  Zotero staff answered "select all … and press Enter"
  ([forum](https://forums.zotero.org/discussion/comment/515392/), 2026).
- Extract all highlights of a PDF "with the backlinks"
  ([PDF++ #49](https://github.com/RyotaUshio/obsidian-pdf-plus/issues/49),
  9 comments; [#231](https://github.com/RyotaUshio/obsidian-pdf-plus/issues/231),
  four users).
- Compile annotations from several files into one note
  ([BN #1092](https://github.com/windingwind/zotero-better-notes/issues/1092)).
- Group insert is filed in ZotLit
  ([#1227](https://github.com/aidenlx/zotlit/issues/1227), by the maintainer).
- A different "several at once" is several *citations* in one bracket,
  `[@a; @b]`:
  [Citation #178](https://github.com/hans/obsidian-citation-plugin/issues/178),
  [ZI #405](https://github.com/community-archive/obsidian-zotero-integration/issues/405),
  [ZI #147](https://github.com/community-archive/obsidian-zotero-integration/issues/147),
  [ZotLit discussion 501](https://github.com/aidenlx/zotlit/discussions/501)
  (4 upvotes, among the highest on-topic ZotLit discussions), and a
  [Discord report](https://discord.com/channels/686053708261228577/1156633421922181201/1549830416129855560)
  (*prior crawl*).

Counter-voice: "Because I tend to highlight a lot, workflows that import all
annotations are pretty useless"
([Discord, 2025](https://discord.com/channels/686053708261228577/1156633421922181201/1428418720958644224),
*prior crawl*).

**Signal: moderate, about 8 voices** for a batch of annotations, and about 6
for a multi-cite.

### I7. Choose the form per insert, or set it once

**Asked.**

- A global default *and* a per-insert override: "Insert citation only" as a
  checkbox or modifier (justanotherjurastudent,
  [Zotero forum 133311](https://forums.zotero.org/discussion/133311),
  2026-09).
- "the user should defer what they want to get out of the copied element at
  the moment of pasting—not at the moment of copy" (huy,
  [Logseq forum](https://discuss.logseq.com/t/pdf-annotation-copy-text-with-block-ref-citekey-and-page-number/9149),
  2022). andupaz in the same thread wants a third option, not a replacement.
- Bind the format to the highlight colour, so the colour picks quote or
  callout:
  [PDF++ #31](https://github.com/RyotaUshio/obsidian-pdf-plus/issues/31),
  [#268](https://github.com/RyotaUshio/obsidian-pdf-plus/issues/268), and
  discussions [105](https://github.com/RyotaUshio/obsidian-pdf-plus/discussions/105),
  [145](https://github.com/RyotaUshio/obsidian-pdf-plus/discussions/145) and
  [444](https://github.com/RyotaUshio/obsidian-pdf-plus/discussions/444).
  The maintainer: "required by a lot of people". Users said "It costs a lot of
  time to scroll down the menu" (444), and "I like to incorportate multiple
  different styles of citations when going through a PDF" (145). About six
  users.
- A hidden alternate is not found: the Citation plugin's secondary template is
  on Shift+Enter, and users could not find it
  ([Citation #63](https://github.com/hans/obsidian-citation-plugin/issues/63),
  [#268](https://github.com/hans/obsidian-citation-plugin/issues/268)). In
  ZotLit the Shift+Enter alternate was also reported not to work
  ([discussion 644](https://github.com/aidenlx/zotlit/discussions/644), a bug).
- A format used only for "Extract & copy annotations", separate from the
  toolbar format
  ([PDF++ #377](https://github.com/RyotaUshio/obsidian-pdf-plus/issues/377)).

Prior art for per-insert choice: RemNote's four paste modes (pin, text with
pin, text, source), and ZotFlow's right-click "All formats (embed, text,
pandoc, footnote, wikilink, default)" (*prior notes*). PDF++ format menus on
hotkeys ([README](https://github.com/RyotaUshio/obsidian-pdf-plus)).

Prior art for set-once: Zotero note templates
([docs](https://www.zotero.org/support/note_templates)), ZotLit templates, and
the Readwise export template
([docs](https://docs.readwise.io/readwise/docs/exporting-highlights/obsidian)).

**Signal: strong, about 10 voices.** The need is a *fast* switch between two
or three forms. No voice asks for a large menu.

### I8. Placement and context around the insert

**Asked.**

- Cursor placement after the insert:
  [PDF++ #583](https://github.com/RyotaUshio/obsidian-pdf-plus/issues/583),
  [Logseq discussion 8102](https://github.com/logseq/logseq/discussions/8102),
  and [ZotFlow #47](https://github.com/duanxianpi/zotflow/issues/47).
- The section heading of the passage: "I keep wanting to also see the pdf
  section/subsection alongside the highlighted text"
  ([PDF++ discussion 175](https://github.com/RyotaUshio/obsidian-pdf-plus/discussions/175)).
  Also [ZI #181](https://github.com/community-archive/obsidian-zotero-integration/issues/181)
  and [ZotLit #442](https://github.com/aidenlx/zotlit/issues/442) (chapter
  data).
- Citation *style*: rendered author-date or a raw citekey.
  - "I have to manually change the citation into my desired format each time"
    ([Zotero forum](https://forums.zotero.org/discussion/comment/408860), 2022).
  - [Citation #133](https://github.com/hans/obsidian-citation-plugin/issues/133)
    (6 reactions).
  - [ZI #255](https://github.com/community-archive/obsidian-zotero-integration/issues/255).
- Insert the citation and create the literature note in one step:
  [ZI #151](https://github.com/community-archive/obsidian-zotero-integration/issues/151),
  [#292](https://github.com/community-archive/obsidian-zotero-integration/issues/292)
  and [#307](https://github.com/community-archive/obsidian-zotero-integration/issues/307).
- A marker that an annotation has been used:
  [BN #1417](https://github.com/windingwind/zotero-better-notes/issues/1417),
  14 comments. Citavi shows a green check mark when a knowledge item is in the
  document
  ([manual](https://www1.citavi.com/sub/manual6/en/101_creating_a_publication_with_word.html)).

**Signal: moderate.**

### Workflow map

| Workflow | Forms with direct evidence | Search keys with direct evidence |
|---|---|---|
| Drafting a paper or chapter | I1 citation-only with page label; I2 run-in quote + citation; multi-cite | S1 author and year; S2 remembered words; S5 sources already cited |
| Literature note for one paper | I3 full block, grouped by colour or tag; I6 batch in page order | S7 page order; S4 colour meaning |
| Topic, synthesis or review note | I3 blocks from many papers; I2 short quote + page per cell; I6 by tag | S3 tag as code; S4 colour name |
| Zettelkasten, permanent or daily note | I4 link or embed; I5 text only | S2 text; S1 paper |

The rows are the author's grouping of the evidence. Several users run more
than one workflow. Mixing is direct evidence: one user drags blocks into topic
notes (#294) and another drafts with citations only (thread 133311).

## How comparable tools answer both axes

| Tool | Search and narrowing | What gets inserted | Choice of form |
|---|---|---|---|
| Zotero note editor | Reader sidebar filters by colour, tag, text | `"quote" (Author, Year, p. N)` + comment, linked to page ([pdf_reader](https://www.zotero.org/support/pdf_reader), [note_templates](https://www.zotero.org/support/note_templates)) | Set once (template in Config Editor) |
| Zotero Word "Add Annotation" (9+) | Browse item → attachment → annotation; text filter only ([forum](https://forums.zotero.org/discussion/130573/available-for-beta-testing-add-annotations-directly-to-word-processor-documents)) | Full annotation with live citation; images as images; several at once | None: citation-only is a separate command ([133311](https://forums.zotero.org/discussion/133311)) |
| Zotero 10 Advanced Search | Conditions: annotation type, colour, author, tag, text, comment; nesting; annotation-level results ([blog](https://www.zotero.org/blog/zotero-10/)) | Not an insert tool | — |
| Zotero Word citation dialog | Item search; typed locator `p.34` / `34` | Citation with locator ([docs](https://www.zotero.org/support/word_processor_plugin_usage)) | Per citation (options popup) |
| Better Notes | Template code filters by tag and colour ([1129](https://github.com/windingwind/zotero-better-notes/discussions/1129)) | Note generated from annotations | Set once per template |
| Zotero Integration | Zotero picker; classic view with collections ([#64](https://github.com/community-archive/obsidian-zotero-integration/issues/64)) | Template-rendered import or "insert notes into current document" | Per command (several import formats) |
| ZotFlow | Fuzzy item search, tag parameter ([#46](https://github.com/duanxianpi/zotflow/issues/46), [#83](https://github.com/duanxianpi/zotflow/issues/83)) | Embed, text, Pandoc, footnote, wikilink, image (*prior notes*) | Per copy (right-click menu) |
| PDF++ | Per-PDF only; no cross-PDF search | Templated link or quote, callout, embed ([README](https://github.com/RyotaUshio/obsidian-pdf-plus)) | Toolbar dropdown and format menus; colour binding requested |
| PDF Scholia Scribe | Per-PDF selection | `"quote" (Author year:page)`, quote block, callout ([listing](https://community.obsidian.md/plugins/pdf-scholia-scribe)) | Per copy (palette format) |
| Zotero Completion | Command palette; comment or highlight text ([listing](https://community.obsidian.md/plugins/zotero-completion)) | `zotero://open-pdf` link with page | None |
| Zotero Annotations (bpiwowar) | Scoped to the paper under the cursor or the note's cited papers ([listing](https://community.obsidian.md/plugins/zotero-annotations)) | Drag: quote with link back | None |
| Citations (hans) | Fuzzy title, author, year search; field syntax requested ([#46](https://github.com/hans/obsidian-citation-plugin/issues/46)) | Citation only, no annotations | Primary and secondary template (Shift+Enter) |
| Readwise → Obsidian | None in Obsidian | Per-source page, appended; Jinja template with text, note, location, tags ([docs](https://docs.readwise.io/readwise/docs/exporting-highlights/obsidian)) | Set once |
| Readwise Reader | Filter language `tag:`, `author:` ([guide](https://docs.readwise.io/reader/guides/filtering/syntax-guide)) | — | — |
| Hypothesis | Typed prefixes `tag:`, `user:`, `url:` ([help](https://web.hypothes.is/help/how-hypothesis-search-works/)) | Share link per annotation | — |
| Citavi Word Add-In | Knowledge tab; search for references by author or title word | Knowledge item text + citation; page range typed without "p." ([manual](https://www1.citavi.com/sub/manual6/en/wai_inserting_knowledge_items.html)) | "Insert advanced" for extra options |
| RemNote | — | Pin / text with pin / text / source (*prior notes*) | Per paste |
| Logseq | — | Block ref or text; "copy with reference" requested ([forum](https://discuss.logseq.com/t/pdf-annotation-copy-text-with-block-ref-citekey-and-page-number/9149)) | Per copy (two menu items) |

Rows marked *prior notes* come from
`other_software_annotation_models.md` and `zotero_obsidian_ecosystem.md`.
Bookends, Highlights, LiquidText and MarginNote are left out, because no
first-party source on this question was reached.

## Tensions and open questions

### Tensions

1. **One gesture, two meanings.** Zotero staff hold that inserting an
   annotation means its full contents (thread 133311). Drafting users want
   the annotation only as the source of a page locator (I1). Note-builders
   want the full block (I3). Both groups use the same pick-an-annotation
   gesture.
2. **Per insert or set once.** Template users set a form once. Drafting users
   and PDF++ users ask for a fast switch (I7), and some want both a default
   and an override. A hidden alternate key goes unfound (Citation #63, #268).
3. **Copy or reference.** A copy is portable: it survives export, other
   editors and the loss of the plugin, and it suits a Pandoc draft. A copy
   also drifts (#294). A reference stays current and shows where a passage is
   used (#274), but it needs a renderer. The writer of a draft and the writer
   of a permanent note pull in different directions.
4. **Colour is personal.** Colour is the most common carrier of meaning (S4),
   but the meanings differ: importance, argument role, section, excerpt type.
   Some users do not use colour. Colour can be a search key, a group label, or
   a form selector (I7). These three uses may conflict.
5. **Typed tokens or visible controls.** The one field-syntax voice
   (Citation #46) and the prefix languages of Hypothesis and Readwise sit
   against Zotero's condition builder, the classic-picker fallback, and
   ZotLit users who find template syntax hard. No evidence shows which one
   writers use from the cursor.
6. **Paper first or passage first.** Writers remember author and year (S1).
   Search over highlight text assumes they remember words (S2). One query box
   has to rank both.
7. **Order.** Recency is asked for citations. Page order is asked for
   annotations within a paper. Nobody asked for cross-paper recency of
   annotations.

### Open questions for the design discussion

- When a writer picks an annotation in a draft, how often do they want the
  quote and how often only the locator? No source measures this. Thread
  133311 says "many of us", and the Reddit +24 comment suggests
  citation-first writers are common.
- Is the citation-only form part of annotation search, or of citation search
  that offers the annotations of the chosen paper as page sources? Zotero
  staff point the second way ("current page number when citing an open
  document").
- Should the inserted form follow the annotation (its colour or type), the
  note (literature note or draft), or the gesture (key or modifier)? PDF++
  users ask for the first. No source asks for the second.
- When a writer narrows by tag or colour, do they want to *pick one* passage
  or *collect all*? The second is closer to Query Blocks than to a suggester.
- Should the search be scoped by default to the papers the current note
  already cites (S5)?
- How should colour names reach search before #1620 exists? Hex values and
  the names of Zotero's swatches are not what users mean.
- What does an image annotation become in a draft that goes to Pandoc: an
  embedded image file, a link, or nothing?
- Are the needs for a paraphrase slot and a used-annotation marker real?
  Neither has a direct request. Citavi and Better Notes #1417 come closest.
- Does a multi-cite (`[@a, p. 3; @b, p. 7]`) built from several annotations
  belong to this feature or to the citation suggester (#501)?
