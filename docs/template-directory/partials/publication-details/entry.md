---
title: Publication details
summary: A line of publication details for journal articles, books, book chapters, and theses, with the details that each kind of source needs.
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

A detail that Zotero has no value for is left out with its label, so the line never shows "Vol. null", an empty "No.", or a stray dot. Pages that hold a hyphen, a dash, or a comma show after `pp.`; a single page shows after `p.`. Each value is the text from Zotero, unchanged. Conference papers, letters, and other kinds of source get no line.

The line ends with a blank line, so the next part of the note starts a new paragraph. When the partial writes nothing, it leaves no blank line. To keep the same details as properties, for sorting and filtering, use the **Publication details by item type** property entry.
