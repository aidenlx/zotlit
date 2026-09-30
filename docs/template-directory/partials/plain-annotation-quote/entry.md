---
title: Plain annotation quote
summary: One annotation as a plain quote with a link to its page, the image for image annotations, and your Zotero comment below it.
minAppVersion: "2.2.0-beta.2"
context: annotation
tasks: [general-reading]
features: [page-links, comments, images]
problems:
  - I want my highlights as plain quotes, without callouts or colors.
  - My comments get mixed up with the author's words.
  - I want to jump from a highlight to its page in the PDF.
  - My image annotations do not show in the note.
keywords:
  - annotation
  - highlight
  - quote
  - blockquote
  - comment
  - page link
  - image annotation
  - formattedAnnotations
  - zt-annot
audience: Readers who build their own profile and want each annotation as a quote they can copy into their writing.
effort: Add the partial to your template folder and call it from your profile's annotation format.
---

Each annotation becomes a Markdown quote:

- a highlight or underline quotes its text and ends with its page, as a link to that page in the PDF;
- an image or ink annotation embeds its image in the quote, followed by its page;
- a note or text annotation has no quoted text, so its comment appears as ordinary text with its page.

Your Zotero comment follows the quote as ordinary text, so your thinking and the author's words stay apart. The quote is the same whatever the highlight color. When Obsidian cannot reach the PDF, the page shows as plain text.

The partial reads one annotation's data. Call it from the annotation format of a profile, the part below `--- zotlit:annotation ---`:

```liquid
{% render "plain-annotation-quote" with zt as zt %}
```
