---
title: PDF link
summary: A link in the note's properties that opens the item's PDF in Zotero's reader, where your highlights and comments are.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review, close-reading]
features: [properties, source-links]
problems:
  - I want to open the PDF from my note's properties.
  - I want a column in my Bases view that opens each paper's PDF.
  - My PDF link property is broken when the item has no PDF.
keywords:
  - PDF
  - PDF link
  - attachment
  - open PDF
  - zotero://open
  - reader
  - link
audience: Readers who keep their PDFs in Zotero and want to open one from the literature note's properties.
effort: Add one property to your profile in the Properties tab.
expected:
  journal-article: { pdf: "zotero://open/library/items/IANPDF25" }
  conference-paper: { pdf: "zotero://open/library/items/CNPDF26A" }
  book: {}
  book-section: { pdf: "zotero://open/library/items/TVKPDF82" }
  thesis: {}
---

When the item has more than one PDF, the link opens one of them. This can be a different PDF from the one that Zotero opens when you double-click the item.

When the item has no PDF, the note gets no `pdf` property. When you update the note, the link follows Zotero: a PDF that you add gets a link, and when you remove the last PDF, the property goes away.

The link opens Zotero on a computer where Zotero is installed. To open a PDF from your vault in Obsidian, add the **Links row** entry to the note.
