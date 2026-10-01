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

Each entry is the path of one collection: its parent collections, then its own name, joined by `/`. A collection name that holds a `/` therefore reads like two levels.

Each update replaces the list, so it follows when you move the item to other collections in Zotero. When the item leaves its last collection, the update removes the property.

A look made from **Default** already has a `collections` property. A look holds each property name once. So select that property in the **Properties** tab in place of adding a new one, and paste this rule into it.
