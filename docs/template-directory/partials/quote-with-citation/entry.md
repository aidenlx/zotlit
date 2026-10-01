---
title: Quote with citation
summary: One annotation as a plain quote followed by its in-text citation with the page, ready to move into a draft.
minAppVersion: "2.2.0-beta.2"
context: annotation
tasks: [writing, archival-research, literature-review]
features: [citations, comments, images]
problems:
  - I want each quote followed by its citation.
  - When I copy a quote into my draft, I lose where it came from.
  - I want to cite a highlight with its page number.
keywords:
  - citation
  - in-text citation
  - cite
  - quote
  - citekey
  - Pandoc
  - page number
  - writing
  - draft
  - annotation
  - highlight
audience: Readers who write from their notes, such as historians who move quotes into drafts, and want every quote to keep its source.
effort: Add the partial to your template folder and call it from your profile's annotation format. Without the item's citation key, the quote ends with its page and no citation.
---

The citation takes one of two forms:

- In the literature note, it has the form of ZotLit's built-in citation text, as in the examples. ZotLit shows this form in your citation style, and **Export note with citations** formats it with a bibliography.
- When you insert one annotation into another note, by dragging it from the annotation view or with **Insert into note**, the citation follows your own citation text. If you use the built-in citation text, both forms are the same.

When the item has no citation key, the quote ends with its page instead. The page links to that page in the PDF when Obsidian can reach the file, and shows as plain text otherwise.
