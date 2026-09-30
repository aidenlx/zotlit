---
title: Note type marker
summary: "A category: LiteratureNote property on every literature note, so an Obsidian Bases view can select literature notes and nothing else."
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

A `category` property with the value `LiteratureNote` on every literature note of the profile. An Obsidian Bases view whose filter selects notes with `category` set to `LiteratureNote` shows your literature notes and none of your other notes, wherever they are in the vault.

| Item | `category` |
| --- | --- |
| Journal article | LiteratureNote |
| Book | LiteratureNote |
| Book chapter | LiteratureNote |
| Thesis | LiteratureNote |

**When the note is updated**: **Keep the existing value**. ZotLit writes the marker only when the note's `category` is missing or empty. A category you change by hand stays.

The rule is the JSON-e string `"LiteratureNote"`. To use another property name or word, such as `type: paper`, enter the name as the **Property name** and change the word inside the quotation marks of the pasted rule, keeping the quotation marks. Use the same words in your views.

Limits: the marker goes on notes that this profile creates or updates. Literature notes of another profile get it when you add the same property to that profile.
