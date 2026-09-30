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

Each annotation shows the same as in the plain annotation quote, plus a block ID: `^` and the annotation's key in Zotero, such as `^EXAMP001`. A block ID names one block of a note, so other notes can link to it.

- A highlight or underline becomes a plain quote with a link to its page. The block ID sits on its own line after the quote, so it names the quote. Your Zotero comment follows as ordinary text.
- An image or ink annotation embeds its image in the quote, with the link to its page on the next line. The block ID and your comment follow, the same as for a highlight.
- A note or text annotation has no quoted text, so its comment appears as ordinary text with its page. The block ID sits at the end of that line, after the page: `Compare these findings with the replication study. (p. 3) ^EXAMP003`.

An annotation with no text, image, or comment writes nothing.

The block ID comes from the annotation's key in Zotero, which never changes. When you edit the comment, change the highlight, or change its color in Zotero, the note updates and the block ID stays the same, so every link to it still works. Obsidian hides the block ID in **Reading view**.

To embed a highlight in another note, type `![[`, the name of the literature note, and `#^`, then select the highlight from the list, for example `![[riveraResearchInterfaces2026#^EXAMP001]]`. Leave out the `!` for a link instead of an embed.

The partial reads one annotation's data. Call it from the annotation format of a profile, the part below `--- zotlit:annotation ---`:

```liquid
{% render "quote-with-block-id" with zt as zt -%}
```

Obsidian finds a block ID only when a blank line follows it. The simple reading note profile puts a blank line between annotations. In a profile of your own, keep a blank line between annotations in the note body.
