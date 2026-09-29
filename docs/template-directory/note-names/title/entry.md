---
title: Title
summary: Names each literature note by the item's title, such as Thinking, fast and slow.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading]
problems:
  - I want my literature notes named by the title of the paper or book.
  - A colon in the title breaks my note name.
  - A slash in the title puts my note in a subfolder.
  - My note names show an underscore where the title had a colon.
keywords:
  - title
  - file name
  - filename
  - note name
  - note title
  - output path
  - colon
  - slash
  - special characters
audience: Readers who find their notes by the title of the work.
effort: Paste one line into your profile's note name. Notes you create from then on get the new name.
---

Each literature note is named by the item's title, such as `Thinking, fast and slow`. Characters a file name cannot hold are changed, so every note is one file in your literature note folder:

- a colon becomes a dash: `Bicycle Sharing in Developing Countries: A proposal…` becomes `Bicycle Sharing in Developing Countries - A proposal…`;
- a slash, a backslash, or a vertical bar becomes a hyphen, so a title never makes a subfolder;
- square brackets become round brackets, and double quotes become single quotes;
- `?`, `*`, `<`, `>`, `#`, and `^` are left out.

An item with no title is named by its Zotero item key, a code of eight letters and digits. When a note with the same name already exists, the new note gets a short random ending, such as `Thinking, fast and slow_a1B2c3`, so ZotLit can still create it.

To use it, open a literature note that uses your profile and run **Customize this note's template**. In the Template Workbench View, select the **Name and folder** tab and replace the text in **Note name template** with the line of this entry. **Preview** shows the name for the selected item. Notes you already have keep their names.
