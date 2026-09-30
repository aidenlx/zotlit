---
title: Collections
summary: The Zotero collections that hold the item, each with its parent collections, as a list.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review]
features: [properties]
problems:
  - I want to see which Zotero collections a paper is in.
  - I want to filter my literature notes by Zotero collection.
  - I want my Zotero folders in my Obsidian notes.
keywords:
  - collections
  - collection
  - folders
  - collection_paths
  - project
  - Zotero collection
audience: Readers who sort their Zotero library into collections by project or topic and want to filter notes the same way.
effort: Add one property to your profile in the Properties tab.
expected:
  journal-article: { collections: [Shared key] }
  conference-paper: { collections: [Shared key] }
  book: {}
  book-section: {}
  thesis: {}
---

The item's Zotero collections, as a `collections` list property. Each entry is the full path of one collection, with its parent collections in front, such as `Thesis/Chapter 2`. An Obsidian Bases view can then show the notes of one collection or project.

| Item | `collections` |
| --- | --- |
| Journal article | Shared key |
| Conference paper | Shared key |
| Book, book chapter, thesis | (no property: the example items are in no collection) |

When the item is in no collection, the note gets no `collections` property.

**When the note is updated**: **Replace the existing value**. When you move the item to other collections in Zotero, the list follows on the next update.

Limits: a profile made from the Default profile already has a `collections` property. A profile holds each property name once, so select that property in the **Properties** tab in place of adding a new one, and paste this entry's rule into it. A collection name that holds a `/` reads like two levels of collections.
