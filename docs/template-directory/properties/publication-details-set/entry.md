---
title: Publication details by item type
summary: Separate properties for the details each kind of source has — journal, volume, issue, and pages for an article; publisher, place, edition, and ISBN for a book; book title, editors, and pages for a book chapter; university and thesis type for a thesis.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, reading-books, writing]
itemTypes: [journalArticle, book, bookSection, thesis]
features: [properties]
problems:
  - I want volume, issue, and pages for articles but publisher and ISBN for books.
  - My properties show "Vol. null" or an empty "Issue" when Zotero has no value.
  - Different properties for books and articles.
  - How do I show the book title and editors of a book chapter?
  - How do I show the university of a thesis?
keywords:
  - frontmatter
  - YAML
  - metadata
  - item type
  - itemType
  - journal
  - volume
  - issue
  - pages
  - publisher
  - place
  - edition
  - ISBN
  - book title
  - editors
  - university
  - thesis type
  - publicationTitle
  - Bases
  - Dataview
  - spread entry
audience: Readers who collect articles, books, chapters, and theses and want each note to carry the publication details of its kind of source as properties.
effort: Add one rule to your profile in the Template Workbench. No other setup.
expected:
  journal-article:
    journal: PLoS Medicine
  conference-paper: {}
  book:
    publisher: Penguin Books
  thesis: {}
  book-section:
    book-title: "Judgment under Uncertainty: Heuristics and Biases"
    editors: [Daniel Kahneman, Paul Slovic, Amos Tversky]
    pages: 3–20
  letter: {}
  manuscript: {}
  interview: {}
  document: {}
---

The publication details of every source as separate properties, chosen by the kind of source. Each note gets the details that its kind of source has, ready to show and filter in an Obsidian Bases view or with the Dataview plugin.

| Kind of source | Properties |
| --- | --- |
| Journal article | `journal`, `volume`, `issue`, `pages` |
| Book | `publisher`, `place`, `edition`, `isbn` |
| Book chapter (Zotero's "Book Section") | `book-title`, `editors` (a list, one name per line), `pages` |
| Thesis | `university`, `thesis-type` (such as `PhD thesis`) |

Other kinds of source, such as conference papers, letters, and manuscripts, get none of these properties. For the journal, proceedings, or book of every kind of source in one property, use `venue` from the Core citation set.

A property is left out when Zotero has no value for it, so a note never shows "Vol. null", an empty issue, or a stray "No.". An article with no issue number gets `journal`, `volume`, and `pages` only. Each value is the text from Zotero, such as `3–20` for pages or `2nd` for an edition.

**When the note is updated:** **Replace the existing value**. Each update writes the current values from Zotero, so correct a detail in Zotero, not in the note. If you delete a value in Zotero, or change the item to another kind of source, the old properties keep their values in the note until you delete them there too. If you delete a property from the note while Zotero still has its value, the next update adds it back.

To add the rule to a profile:

1. In Obsidian, open ZotLit's settings and go to **Literature note profiles**. On the row of the profile you want to change, select **Edit profile** (the pencil button). The Template Workbench opens.
2. Select the **Properties** tab, then **Add several properties from one rule**.
3. In **Value**, replace the example rule with this entry's rule: everything from the first `{` to the last `}`.
4. Set **When the note is updated** to **Replace the existing value**.

The preview shows the properties for the selected item; select a book, a book chapter, or a thesis to see its details. Notes get them the next time you create or update them.
