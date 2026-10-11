---
title: Quote with a block ID
summary: One annotation as a plain quote with a fixed block ID, so links and embeds to that highlight from other notes keep working after updates.
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

The block ID is `^` and the annotation's key in Zotero. That key never changes, so the ID stays the same when you edit the comment, change the highlight, or change its color in Zotero. Obsidian hides the ID in **Reading view**.

To embed a highlight in another note, type `![[`, the name of the literature note, and `#^`, then select the highlight from the list. Leave out the `!` for a link instead of an embed.

Obsidian finds a block ID only when a blank line follows it. Keep a blank line between annotations in the note body of your look. An annotation with no text, image, or comment writes nothing.
