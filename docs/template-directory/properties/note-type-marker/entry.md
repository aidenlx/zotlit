---
title: Note type marker
summary: A category property set to LiteratureNote on every literature note, so an Obsidian Bases view can list your literature notes and none of your other notes.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review]
features: [properties]
problems:
  - My Bases view shows all my notes, not only the literature notes.
  - I want to filter literature notes from my other notes.
  - I want to mark every note I make from Zotero.
keywords:
  - category
  - type
  - note type
  - LiteratureNote
  - literature note
  - marker
  - Bases filter
  - Dataview
audience: Readers who build Obsidian Bases views or tables from the Dataview plugin over their literature notes and keep other notes in the same vault.
effort: Add one property to your profile in the Properties tab.
expected:
  journal-article: { category: LiteratureNote }
  book: { category: LiteratureNote }
  book-section: { category: LiteratureNote }
  thesis: { category: LiteratureNote }
---

In the view, filter on notes where `category` is `LiteratureNote`. This works wherever the notes are in your vault.

When you update the note, ZotLit writes the marker only when `category` is missing or empty. A value that you change by hand stays.

To use another property name and word, such as `type: paper`, enter your name as the **Property name**. In the pasted rule, change the word between the quotation marks and keep the marks. Use the same words in your view.

The marker goes only on notes of the look that has this property. To mark the notes of another look, add the property to that look too.
