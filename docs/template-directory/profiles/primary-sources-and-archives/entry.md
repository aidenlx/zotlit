---
tasks: [archival-research]
itemTypes: [letter, manuscript, interview, document, newspaperArticle]
features: [source-links, abstract, comments, images, citations, own-notes, prompts, properties]
problems:
  - I want a template for letters, manuscripts, interviews, and other archive sources.
  - My source notes need the archive, the box and folder, the date, and the place.
  - I want each quote followed by its citation, so I can move quotes into my draft.
  - I want sections for context, content, and connections in every source note.
  - I want archive sources to get their own template automatically.
  - My letters only show the year, or show a day I never entered.
  - My own notes get overwritten when the note updates.
keywords:
  - primary source
  - primary sources
  - archive
  - archives
  - archival research
  - history
  - historian
  - letter
  - correspondence
  - manuscript
  - diary
  - interview
  - oral history
  - document
  - newspaper
  - Loc. in Archive
  - archiveLocation
  - box and folder
  - source criticism
  - in-text citation
  - item type
  - itemType
  - match
  - persist
  - Zotero Integration
audience: Historians and other researchers who work with letters, manuscripts, interviews, documents, and newspapers, and want each source note to record where the source is kept and when and where it was made.
effort: Import it, then create a note for a source. ZotLit chooses it by itself for letters, manuscripts, interviews, documents, and newspaper articles; the archive details come from the fields you fill in for the item in Zotero.
---

A source note for archive work. Each note records where the source is kept and when and where it was made, quotes your highlights with their citations so you can move them into a draft, and leaves room for your own reading of the source.

Each note holds:

- the source's title;
- one row of links back to the source: the item in Zotero, its PDF, its DOI, and its web page, each when the item has one;
- the abstract, folded, so it is at hand without taking over the note;
- your annotations in page order. A highlight or underline becomes a plain quote followed by its in-text citation with the page, such as `[@aldousLetterEleanorWhitcombe1887, {p. 2}]`, and your Zotero comment follows it as ordinary text, so your words and the source's stay apart. Image annotations appear as embedded images followed by the citation, and notes and text boxes you add in the PDF appear as their text followed by the citation;
- three empty sections for your own reading of the source: **Context** (who made it, when, where, and for whom), **Content** (what it says), and **Connections** (how it relates to your other sources and to your research questions).

The citation has the form of ZotLit's built-in citation text. ZotLit shows it in your citation style, and **Export note with citations** formats it with a bibliography. It uses the item's citation key, which comes from Zotero's own **Citation Key** field or from the Better BibTeX plugin. When the item has no citation key, the quote ends with its page instead, as a link to that page in the PDF.

Everything from Zotero sits in the part of the note that ZotLit refreshes when you update the note. The three sections sit outside it, so an update never touches what you write there. To change the text of an annotation, edit its comment in Zotero; the comment appears under the quote on the next update.

The note gets these properties, ready to sort and filter in an Obsidian Bases view:

| Property | Value | When the note is updated |
| --- | --- | --- |
| `title` | The source's title | Replace the existing value |
| `authors` | The source's authors: the writer of a letter, the person interviewed in an interview | Replace the existing value |
| `date` | The full date, such as `1887-03-14`, when Zotero records the day | Replace the existing value |
| `year` | The year | Replace the existing value |
| `item-type` | The kind of source, such as `Letter` or `Manuscript` | Replace the existing value |
| `venue` | The newspaper, or else the publisher or issuing body | Replace the existing value |
| `archive` | The item's **Archive** field in Zotero | Replace the existing value |
| `archive-location` | The item's **Loc. in Archive** field in Zotero, such as a box and folder | Replace the existing value |
| `place` | The item's **Place** field in Zotero, or for a letter its **Event Place** field | Replace the existing value |
| `citekey` | The citation key | Replace the existing value |
| `tags` | The item's Zotero tags, with spaces changed to underscores | Add to the existing list |

A property is left out when the source has no value for it. Archive sources often have only a year or a month, or a date in words such as "undated". `date` holds a full date only when Zotero records the day, so no note shows a day that the source does not give, and Obsidian can show `date` as a date property. `year` dates every source that has a year. To put your sources in time order in a Bases view, sort by `year`, then by `date`. The date as you entered it stays in Zotero.

Tags you add in Obsidian stay when the note updates. A tag you remove in Zotero stays in the note until you delete it from the note too. Spaces in a Zotero tag become underscores. Other characters stay as they are, so a Zotero tag with a comma or a `#` in it needs a manual fix in Obsidian.

ZotLit chooses this profile by itself when you create a note for a Zotero item of the type **Letter**, **Manuscript**, **Interview**, **Document**, or **Newspaper Article**. The historians' templates shared on the Obsidian forum are made for letters, interviews, and newspapers. Manuscript and Document are the item types Zotero users choose for unpublished papers, such as diaries, notebooks, and the minutes of a meeting. Document is also Zotero's item type for anything that fits no other type, so such an item gets this profile too.

Reports keep the profile they use now, because reports are often research reports and working papers that you read as secondary literature. For a report or any other item that is a primary source for you, choose this profile when you create the note. If another profile of yours already takes that item, create the note, then run **Switch literature note profile** from the note and choose this profile.

The import sheet shows the profile's condition in words, which starts **Item type is Letter**. Keep **Import match conditions** on to let ZotLit choose the profile by itself for these five item types. Turn it off to import the profile without its condition; ZotLit then never chooses it by itself, and you choose it when you create a note. If another profile of yours also matches one of these item types, ZotLit asks which one to use. Notes you already have keep the profile that wrote them.
