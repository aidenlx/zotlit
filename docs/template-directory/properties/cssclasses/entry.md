---
title: CSS classes
summary: A literature-note CSS class on every literature note, so a CSS snippet or your theme can style literature notes apart from other notes.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading]
features: [properties]
problems:
  - I want my literature notes to look different from my other notes.
  - I want wider pages for my literature notes.
  - My cssclasses are lost when the note updates.
keywords:
  - cssclasses
  - cssclass
  - CSS snippet
  - style
  - theme
  - wide page
  - appearance
audience: Readers who use a CSS snippet or a theme feature to change how literature notes look.
effort: Add one property to your profile in the Properties tab, and a CSS snippet or theme that uses the class.
expected:
  journal-article: { cssclasses: [literature-note] }
  book: { cssclasses: [literature-note] }
  book-section: { cssclasses: [literature-note] }
  thesis: { cssclasses: [literature-note] }
---

The class changes nothing by itself: a CSS snippet or your theme styles it. For example, the snippet `.literature-note { --file-line-width: 60rem; }` makes literature notes wider. Save it as a `.css` file in your vault's snippets folder, and turn it on in **Settings > Appearance > CSS snippets**. To use a class from your theme, add it to the rule.

Each update adds `literature-note` when the note does not have it, and keeps every other class in the note.

- A class you delete from one note comes back on its next update. To remove it from every note, remove it from the rule.
- When `cssclasses` holds text and not a list, ZotLit adds no class.
