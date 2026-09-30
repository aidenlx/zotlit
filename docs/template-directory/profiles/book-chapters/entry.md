---
tasks: [reading-books, general-reading]
itemTypes: [bookSection]
features: [source-links, abstract, page-links, comments, images, color-highlights, own-notes, prompts, properties]
problems:
  - I want chapter notes that name the book the chapter is in.
  - How do I show the book title and editors of a book chapter?
  - My chapter notes need the chapter's pages.
  - The editors of the book are missing from my chapter notes.
  - I want book chapters to get their own template automatically.
  - My own notes get overwritten when the note updates.
  - Colors don't show in my notes.
keywords:
  - book chapter
  - chapter
  - book section
  - bookSection
  - edited volume
  - edited book
  - anthology
  - handbook
  - collected essays
  - editors
  - book title
  - containerTitle
  - pages
  - item type
  - itemType
  - match
  - colour
  - persist
  - Zotero Integration
audience: Readers of chapters in edited books who want each chapter note to name the book, its editors, and the chapter's pages, so the chapter can be cited correctly.
effort: Import it, then create a note for a book chapter. ZotLit chooses it for every book chapter by itself; your color meanings are set once, in one file, and the ones it starts with work as they are.
---

**Update literature note** refreshes the part from Zotero; your three sections stay. To change the text under a highlight, edit its comment in Zotero.

Enter the book's editors in Zotero as **Editor**, so they show apart from the chapter's authors.

On update, `status` and the tags you add in Obsidian stay. Every other property takes the Zotero value. A Zotero tag with a comma or a `#` needs a manual fix in Obsidian.

A change to the color meanings reaches every note that uses them.

With **Import match conditions** on, ZotLit uses this look for every book chapter. Turn it off to select it for each note yourself. If another look also matches book chapters, ZotLit asks which to use.
