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

When the note updates: **Keep the existing value**. ZotLit writes the marker only when the note's `category` is missing or empty. A category you change by hand stays.

To add it to a profile:

1. Open **Settings > ZotLit > Literature note profiles** and select **Edit profile**, the pencil button, on your profile.
2. In the **Properties** tab, select **Add a property**. Enter `category` as the **Property name**.
3. In the **Value format** menu beside **Value**, choose **Fixed text**, then select **Change format and reset value**.
4. Enter `LiteratureNote` into **Value**.
5. Set **When the note is updated** to **Keep the existing value**.

To use another property name or word, such as `type: paper`, enter those in steps 2 and 4, and use the same words in your views.

Limits: the marker goes on notes that this profile creates or updates. Literature notes of another profile get it when you add the same property to that profile.
