---
title: Publication details
summary: One line under the title with the details of the item's kind of source — journal, volume, issue, and pages for an article; publisher, place, edition, and ISBN for a book; the book, its editors, and the pages for a book chapter; thesis type and university for a thesis.
minAppVersion: "2.2.0-beta.0"
context: note
tasks: [general-reading, reading-books]
itemTypes: [journalArticle, book, bookSection, thesis]
problems:
  - I want the journal, volume, and pages of an article in my note.
  - I want the publisher and ISBN of a book in my note.
  - How do I show the book title and editors of a book chapter?
  - How do I show the university of a thesis?
  - My note shows "Vol. null" or an empty "No." when Zotero has no value.
  - Different details for books and articles.
keywords:
  - publication details
  - bibliographic details
  - metadata
  - item type
  - itemType
  - journal
  - publicationTitle
  - volume
  - issue
  - pages
  - publisher
  - place
  - edition
  - ISBN
  - book title
  - editors
  - edited volume
  - university
  - thesis type
  - dissertation
audience: Readers who build their own profile and want each note to show, under its title, the publication details of its kind of source.
effort: Add the partial to your template folder and call it from your profile's note body.
---

One line of publication details, chosen by the kind of source and separated by middle dots:

| Kind of source | The line shows | Example |
| --- | --- | --- |
| Journal article | the journal, volume, issue, and pages | *PLoS Medicine* · Vol. 2 · No. 8 · p. e124 |
| Book | the publisher, place, edition, and ISBN | Penguin Books · London · ISBN 978-0-14-103357-0 |
| Book chapter (Zotero's "Book Section") | the book and its editors, then the chapter's pages | In *Judgment under Uncertainty: Heuristics and Biases*, edited by Daniel Kahneman, Paul Slovic, and Amos Tversky · pp. 3–20 |
| Thesis | the thesis type and the university | PhD thesis · University of Oxford |

A detail that Zotero has no value for is left out, together with its label, so the line never shows "Vol. null", an empty "No.", or a stray dot. An article with no issue number shows its journal, volume, and pages only. Pages that name one page, such as `e124`, show as `p. e124`; a range such as `3-20` shows as `pp. 3-20`. Each value is the text from Zotero, so an edition you entered as `2nd` shows as `Edition: 2nd`. Other kinds of source, such as conference papers and letters, get no line.

The partial reads the note's data. Call it from the note body of a profile, inside the managed block, for example right under the title:

```liquid
# {{ zt.title }}

{% render "publication-details" with zt as zt -%}
```

The line ends with a blank line, so the next part of the note starts a new paragraph. When the partial writes nothing, it leaves no blank line behind. To keep the same details as properties, for sorting and filtering, use the **Publication details by item type** property entry.
