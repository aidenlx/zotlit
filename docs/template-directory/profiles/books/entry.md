---
tasks: [reading-books]
itemTypes: [book]
features: [source-links, abstract, page-links, comments, images, color-highlights, own-notes, prompts, properties]
problems:
  - I want a template for books, not articles.
  - My book notes need the publisher, place, edition, and ISBN.
  - I want sections for a summary, key points, and ideas to explore in every book note.
  - My own notes get overwritten when the note updates.
  - I want books to get their own template automatically.
  - My book notes show "Vol. null" or an empty journal.
  - Colors don't show in my notes.
keywords:
  - book
  - books
  - monograph
  - textbook
  - reading notes
  - book notes
  - publisher
  - place
  - edition
  - ISBN
  - item type
  - itemType
  - match
  - colour
  - persist
  - Zotero Integration
audience: Readers of books who want each book note to carry the book's publication details and to leave room for their own summary, key points, and ideas to explore.
effort: Import it, then create a note for a book. ZotLit chooses it for every book by itself; your color meanings are set once, in one file, and the ones it starts with work as they are.
---

**Update literature note** refreshes the part from Zotero; your three sections stay. To change the text under a highlight, edit its comment in Zotero.

On update, `status` and the tags you add in Obsidian stay. Every other property takes the Zotero value. A Zotero tag with a comma or a `#` needs a manual fix in Obsidian.

A change to the color meanings reaches every note that uses them.

With **Import match conditions** on, ZotLit uses this look for every book. Turn it off to select it for each note yourself. If another look also matches books, ZotLit asks which to use.
