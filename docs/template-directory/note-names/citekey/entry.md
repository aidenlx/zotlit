---
title: Citation key
summary: Names each literature note by the item's citation key, such as ioannidisWhyMost2005.
minAppVersion: "2.2.0-beta.0"
tasks: [writing, general-reading]
problems:
  - I want my literature notes named by citation key.
  - My note names should match the keys I cite with in Pandoc.
  - How do I name notes by citekey, as in Zotero Integration?
keywords:
  - citekey
  - citation key
  - Better BibTeX
  - BBT
  - file name
  - filename
  - note name
  - note title
  - output path
  - rename notes
audience: Readers who cite with Better BibTeX or Pandoc keys and want each note's name to match the key.
effort: Paste one line into the "Note name template" field of your profile. Notes you create from then on get the new name.
---

Each literature note is named by the item's citation key, such as `ioannidisWhyMost2005`. Citation keys come from Better BibTeX for Zotero, or from the item's Citation Key field in Zotero.

- An item with no citation key is named by its Zotero item key, a code of eight letters and digits such as `WEBFAQ24`.
- A citation key that holds a character a file name cannot hold is changed as in the "Title" note name: `/`, `\`, `|`, and `:` become a hyphen, square brackets become round brackets, a double quote becomes a single quote, and `?`, `*`, `<`, `>`, `#`, and `^` are left out. So the note is always one file in your literature note folder.
- When a note with the same name already exists, the new note gets a short random ending, such as `ioannidisWhyMost2005_a1B2c3`, so ZotLit can still create it.

To use it, open a literature note that uses your profile and run **Customize this note's template**. In the Template Workbench View, select the **Name and folder** tab and replace the text in **Note name template** with the line of this entry. **Preview** shows the name for the selected item, as it is when no other note has that name. Notes you already have keep their names.
