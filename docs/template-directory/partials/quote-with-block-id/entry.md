---
title: Quote with a block ID
summary: One annotation as a plain quote with a fixed block ID, so you can link to or embed that highlight in any note, and the link still works after updates.
minAppVersion: "2.2.0-beta.0"
context: annotation
tasks: [writing, general-reading]
features: [block-references, page-links, comments, images]
problems:
  - I want to embed one highlight in another note.
  - My links to a highlight break when the note updates.
  - I want to reuse my highlights in my permanent notes.
  - I want block references for my annotations.
keywords:
  - block reference
  - block ID
  - block link
  - embed
  - transclusion
  - Zettelkasten
  - permanent note
  - blockID
  - annotation
  - highlight
audience: Readers who reuse highlights in other notes, such as permanent notes or drafts, by linking to or embedding one highlight.
effort: Add the partial to your template folder and call it from your profile's annotation format.
---

Each annotation becomes a plain quote with a link to its page, the same as the plain annotation quote, plus a block ID: `^` and the annotation's key in Zotero, such as `^EXAMP001`. A block ID names one block of a note, so other notes can link to it.

- For a highlight, underline, image, or ink annotation, the block ID sits on its own line after the quote, so it names the quote. Your Zotero comment follows as ordinary text.
- For a note or text annotation, which has no quoted text, the block ID sits at the end of its comment.

The block ID comes from the annotation's key in Zotero, which never changes. When you edit the comment, change the highlight, or change its color in Zotero, the note updates and the block ID stays the same, so every link to it still works. The block ID does not show in reading view.

To embed a highlight in another note, type `![[`, the name of the literature note, and `#^`, then select the highlight from the list, for example `![[riveraResearchInterfaces2026#^EXAMP001]]`. Leave out the `!` for a link instead of an embed.

The partial reads one annotation's data. Call it from the annotation format of a profile, the part below `--- zotlit:annotation ---`:

```liquid
{% render "quote-with-block-id" with zt as zt %}
```

Keep a blank line between annotations in your profile's note body, so each block ID stays with its quote.
