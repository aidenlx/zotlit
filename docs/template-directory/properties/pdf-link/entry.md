---
title: PDF link
summary: A link that opens the item's first PDF in Zotero's reader, left out when the item has no PDF.
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
  book-section: {}
  thesis: {}
---

A link to the item's PDF, as a `pdf` property. Obsidian shows the link in the note's properties; select it to open the PDF in Zotero's reader, where your highlights and comments are.

| Item | `pdf` |
| --- | --- |
| Journal article | zotero://open/library/items/IANPDF25 |
| Conference paper (two PDFs) | zotero://open/library/items/CNPDF26A |
| Book, book chapter, thesis | (no property: the samples have no PDF) |

When the item has more than one PDF, the link opens one of them, which can differ from the PDF that Zotero opens when you double-click the item. When the item has no PDF, the note gets no `pdf` property.

When the note updates: **Replace the existing value**. When you add a PDF to the item in Zotero, the note gets the link on its next update.

To add it to a profile:

1. Open **Settings > ZotLit > Literature note profiles** and select **Edit profile**, the pencil button, on your profile.
2. In the **Properties** tab, select **Add a property**. Enter `pdf` as the **Property name**.
3. In the **Value format** menu beside **Value**, choose **Rule · JSON-e**, then select **Change format and reset value**.
4. In **Value**, replace the example rule with this entry's rule.
5. Set **When the note is updated** to **Replace the existing value**.

Limits: the link opens the PDF in Zotero, on a computer where Zotero is installed, not in Obsidian. To open a PDF that is in your vault inside Obsidian, use the **Links row** partial in the note body.
