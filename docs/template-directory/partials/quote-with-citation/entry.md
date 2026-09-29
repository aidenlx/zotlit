---
title: Quote with citation
summary: One annotation as a plain quote followed by its in-text citation with the page, ready to move into a draft.
minAppVersion: "2.2.0-beta.0"
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
effort: Add the partial to your template folder and call it from your profile's annotation format. The citation needs the item's citation key, as every ZotLit citation does.
---

Each annotation becomes a plain quote that ends with its in-text citation, which names the page:

```markdown
> Clear methods make research easier to reproduce. [@riveraResearchInterfaces2026, {p. 1}]
```

Your Zotero comment follows the quote as ordinary text, so your thinking and the author's words stay apart. An image or ink annotation embeds its image in the quote, followed by the citation. A note or text annotation has no quoted text, so its comment appears as ordinary text, followed by the citation.

The citation takes one of two forms:

- In the literature note, it has the form of ZotLit's built-in citation text, as above. ZotLit shows this form in your citation style, and **Export note with citations** formats it with a bibliography.
- When you insert one annotation into another note, by dragging it from the annotation view or with **Insert into note**, the citation follows your own citation text. If you use the built-in citation text, both forms are the same.

When the item has no citation key, the quote ends with its page instead, as a link to that page in the PDF.

The partial reads one annotation's data. Call it from the annotation format of a profile, the part below `--- zotlit:annotation ---`:

```liquid
{% render "quote-with-citation" with zt as zt %}
```
