# Template Directory

The Template Directory is ZotLit's catalogue of ready-made, verified Directory Entries: Literature Note Profiles a reader imports in one step, and recipes (partials, citation text, note names, properties) a reader copies into a Profile of their own. This folder is its single source of truth. The docs site renders it, and the verification suite in `apps/docs` checks every entry on every `pnpm test`.

Entry descriptions are user-facing copy. Write them for academics who read in Zotero and do not write code: the research task first, the result in the note second, and Obsidian UI labels verbatim (**Import profile…**, **Add a property**, **Rule · JSON-e**, **Add from a rule**, **Add several properties from one rule**). [ADR 0062](../adr/0062-the-template-directory-is-a-repository-held-catalogue-verified-by-rendering.md) records why the Directory is shaped this way.

## Layout

One folder per entry, inside the folder of its kind. The folder name is the entry's slug: lowercase words joined by hyphens.

```text
docs/template-directory/
├── README.md                              this guide
├── profiles/
│   └── simple-reading-note/
│       ├── entry.md                       facets and the reader-facing description
│       ├── zotlit-profile.simple-reading-note.md   the document a reader imports
│       └── samples.md                     rendered samples, written by the suite
├── partials/
│   └── links-row/
│       ├── entry.md
│       ├── zotlit-partial.links-row.md
│       └── samples.md
├── citations/<slug>/        entry.md · zotlit-citation.md · samples.md
├── note-names/<slug>/       entry.md · note-name.liquid   · samples.md
└── properties/<slug>/       entry.md · property.yaml      · samples.md
```

| Kind | Folder | Artifact | Level |
| --- | --- | --- | --- |
| Profile | `profiles/` | `zotlit-profile.<slug>.md`: a Literature Note Profile document | Ready to use |
| Partial | `partials/` | `zotlit-partial.<slug>.md`: a Shared Partial document; the slug is the partial's name | Customize |
| Citation text | `citations/` | `zotlit-citation.md`: a Citation Template document | Customize |
| Note name | `note-names/` | `note-name.liquid`: the Filename Template, exactly as a reader pastes it into **Note name** | Customize |
| Property | `properties/` | `property.yaml`: one Managed Frontmatter entry, with `key` for a static-key entry or without it for a Spread Entry | Customize |

The kind comes from the folder and the level from the kind. Any other file in an entry folder, or any file outside an entry folder other than this guide, fails the suite.

## The entry file

`entry.md` opens with its metadata as YAML between two `---` lines. The Markdown body below it is the reader-facing description: who the entry is for, what the note or recipe produces, and how to use it.

| Field | Kinds | Required | Value |
| --- | --- | --- | --- |
| `tasks` | all | yes | Research tasks the entry serves: `general-reading`, `literature-review`, `close-reading`, `reading-books`, `archival-research`, `teaching`, `writing` |
| `itemTypes` | all | no | Zotero item types the entry is made for (`book`, `bookSection`, …). Leave it out for any item type |
| `features` | all | no | What the entry offers: `source-links`, `abstract`, `page-links`, `comments`, `images`, `color-highlights`, `grouped-by-color`, `own-notes`, `prompts`, `properties`, `child-notes`, `related-items`, `block-references`, `tasks`, `citations` |
| `problems` | all | yes | The problems the entry solves, in the reader's own words, as a reader would search for them |
| `keywords` | all | no | More search words, including ZotLit v1 and Zotero Integration vocabulary |
| `recommended` | all | no | `true` for a recommended starting point |
| `audience` | all | yes | One sentence: who the entry is for |
| `effort` | all | yes | One sentence: what the entry asks of the reader before it works |
| `title`, `summary`, `minAppVersion` | recipes | yes | The entry's name, its one-line summary, and the ZotLit version it needs |
| `context` | partial | yes | The data the partial reads: `note`, `annotation`, or `citation` |
| `call` | partial | no | The Liquid a Profile writes to call the partial, when that is more than `{% render "<slug>" with zt as zt %}`. The suite renders this call |
| `expected` | property | no | Per Directory Sample or type example, the properties the entry writes (see [Property](#property)) |

A Profile entry states its title, summary, and required version once, in its manifest: `name`, `description`, and `minAppVersion`. The partials an entry calls are found from its artifact, directly and through the partials it calls.

The source files in `src/lib/template-directory/` of `apps/docs` own the vocabularies; add a research task or a feature there first.

## Add an entry

### Profile

1. Create `profiles/<slug>/` with `entry.md` and `zotlit-profile.<slug>.md`.
2. Mint the Profile ID once: twelve characters from the alphabet in `apps/obsidian/src/services/profile/service.ts`. Keep it for every later edition, so a newer edition imports as the same Profile. Change `version` for each edition.
3. Set `author`, a one-line `description`, `sampleItemType`, `minAppVersion`, and `contract` (the current template contract).
4. Write the note body in Liquid, with every template tag inside `{% managed %}…{% endmanaged %}`. Text a reader keeps, such as a **My notes** heading, goes outside the block. A note may open with the title heading `# {{ zt.title }}` on its first line, outside the block: the note gets it once, when it is created, and the `title` property keeps the current title.
5. Write every property as a JSON-e rule (`value`), with the merge strategy it needs: `replace` for values from Zotero, `append` for lists the reader adds to, `keep` for values the reader changes by hand.
6. Call partials by name with `{% render "<name>" with zt as zt %}`. Every called partial must be a partial entry.
7. Run the re-pack command. It writes the manifest's `partials` from the partial entries.
8. Run the suite with the update flag, and read the new `samples.md` against the description.

### Partial

1. Create `partials/<slug>/` with `entry.md` and `zotlit-partial.<slug>.md`. The slug is the name every caller uses; the plugin's own slot names (`filename`, `note`, `annotation`, `content`, `citation`) are not available.
2. The artifact is a Shared Partial document: `language: liquid` between two `---` lines, then the source.
3. Set `context` to the data the partial reads. The suite renders a `note` partial in a Profile's note body and an `annotation` partial in its Annotation Section. A partial that needs more than the plain `render` call, such as one that sets values for the partial called after it, states its call in `call`.
4. To change a partial, edit its entry, then run the re-pack command: every Profile that calls it gets the new source.

### Property

1. Create `properties/<slug>/` with `entry.md` and `property.yaml`.
2. `property.yaml` holds one Managed Frontmatter entry: `key` (leave it out for a Spread Entry), `merge`, and `value`, a JSON-e rule. A property the reader fills in by hand, such as a rating, starts empty: its rule writes `null`, and its merge is `keep`.
3. Under `expected` in `entry.md`, state the result for each Directory Sample or type example that matters, by sample ID, as the properties it writes. A property the mapping leaves out is one the entry makes absent for that sample:

   ```yaml
   expected:
     journal-article: { year: 2005 }
     letter: { year: 1887 }
   ```

4. When the value depends on data no Directory Sample holds, such as an article's volume and issue, state those cases in `src/lib/template-directory/property-entries.test.ts` of `apps/docs`. That file also renders every property entry over a title with a colon and quotation marks, and checks that the YAML reads back.

### Citation text

1. Create `citations/<slug>/` with `entry.md` and `zotlit-citation.md`.
2. The artifact is a Citation Template document: `language: liquid` between two `---` lines, then the source. It reads `zt.variant`, `zt.citations`, and `zt.items`.
3. A vault holds one citation text, so the description states that the entry replaces it and how to keep a copy of the current one.

The suite renders the citation text as ZotLit inserts it, on one line, under both Citation Variants: each Directory Sample and Edge Sample cited alone, then the Workbench example sets (two items, a page range, a suppressed author, a prefix and a suffix, and an annotation's page). `samples.md` shows them as one table.

### Note name

1. Create `note-names/<slug>/` with `entry.md` and `note-name.liquid`.
2. The artifact is the Filename Template on one line, with no line break at the end of the file, exactly as a reader pastes it into **Note name template**.
3. End it with `{% suffix %}`, so a second note with the same name is still created.

The suite renders the note name over every Directory Sample and Edge Sample with the suffix left empty, and checks that each result is one file name: not empty, on one line, with no space at either end and no dot at the end, and with none of `\ / : * ? " < > | # ^ [ ]`. A slash would make a folder, Obsidian would change each of the others to `_`, and it removes a final dot.

## Invariants

The suite fails with a named problem code when an entry breaks one of these rules.

| Rule | Problem code |
| --- | --- |
| Entry folders hold only their three files, with lowercase-hyphenated slugs | `unexpected-file`, `missing-file`, `invalid-slug`, `reserved-partial-name` |
| `entry.md` metadata matches the schema above | `invalid-metadata` |
| The artifact parses | `invalid-artifact` |
| A Profile ID is twelve letters or digits and unique in the Directory | `profile-id`, `duplicate-profile-id` |
| A Profile has no `folder`, `importFolder`, or `citationStyle` binding, and no Imported Note binding | `profile-binding` |
| A Profile matches only on built-in item types, never on tags, collections, or Library, and never negated | `profile-match` |
| A Profile targets the current template contract | `profile-contract` |
| A Profile sets `author`, `description`, `sampleItemType`, and `minAppVersion` | `profile-metadata` |
| Every template is Liquid | `template-language` |
| Every property is a JSON-e rule | `property-language` |
| A Profile body has a managed block, and every template tag sits inside it, except a first-line title heading `# {{ zt.title }}` | `managed-block` |
| One namespace: every called partial is a partial entry | `unknown-partial` |
| A Profile packs every partial it calls, byte-identical to the partial entry, and no other | `partial-not-packed`, `packed-partial-differs`, `packed-partial-uncalled` |
| Every entry renders over every Directory Sample and Sample Annotation with no diagnostics | `render-diagnostic` |
| Property output has no `null`, empty, `null`/`undefined`/`NaN` text, dangling separator, or label without a value. A `null` under `keep` is an empty property the reader fills in | `property-output` |
| A property entry writes what its `expected` states | `property-expectation` |
| Citation text has no `null`, empty, `null`/`undefined`/`NaN` text, dangling separator, or label without a value | `citation-output` |
| A note name is one file name: not empty, on one line, no space at either end, no dot at the end, and no character a file name cannot hold | `note-name-output` |
| A note name holds `{% suffix %}` | `note-name-suffix` |

The Profile ID rule covers form and uniqueness only. That an ID never changes between editions is a review rule.

## Directory Samples

Every entry renders over the four Sample Items (`journal-article`, `conference-paper`, `book`, `thesis`) and five items derived from them for types without a Sample Item (`book-section`, `letter`, `manuscript`, `interview`, `document`). The `book-section` item alone has Zotero child notes and a related item (the `book`). An entry made for some item types (`itemTypes`) also renders over the type examples of those types, which fill the fields no Directory Sample holds: a thesis with its university and thesis type (`thesis-with-university`), a book with its place and edition (`book-with-edition`), and a newspaper article (`newspaper-article`). A Profile or `annotation` partial also renders over every Sample Annotation; one with the `color-highlights` feature also renders over a highlight in every other Zotero color and a custom color; one with the `tasks` feature also renders over a highlight whose comment starts with "todo". A Profile or `note` partial with the `grouped-by-color` feature also renders one more note, `every-color`: the conference paper with the Sample Annotations and those color highlights as its annotations, in page order. A `note` partial that renders annotations shows each as one line with its type, color, page, and text or comment. An `annotation` partial renders each one as a single inserted annotation, under ZotLit's built-in citation text, so `zt.citation` holds its page-pinned citation; in a literature note, `zt.citation` is empty. A citation text or note-name entry also renders over three Edge Samples, the cases a citation or a note name must handle: a journal article with four authors (`many-authors`), a report whose title holds every character a file name cannot (`unsafe-title`), and a web page with no author, date, or citation key (`no-author-date-or-citekey`). The suite stores the output in each entry's `samples.md`, so a change in any entry's output shows in review. The `file_link` filter renders nothing in samples, because the Directory Samples have no files in a vault; `plain-annotation-quote` shows how to fall back to plain text, such as `p. 5`.

## Commands

Run these from the repository root.

| Task | Command |
| --- | --- |
| Verify the Directory | `pnpm exec turbo run test --filter=@zotlit/docs` |
| Update `samples.md` after an intended change | `pnpm exec turbo run test --filter=@zotlit/docs -- src/lib/template-directory -u` |
| Re-pack every Profile entry from the partial entries | `pnpm exec turbo run template-directory:repack --filter=@zotlit/docs` |

After a partial changes, the suite fails with `packed-partial-differs` until you re-pack. Re-pack, then update the samples, then review the sample diff.
