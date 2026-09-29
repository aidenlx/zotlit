---
title: Author Year – Title
summary: Names each literature note by its first author, year, and title, such as Kahneman 2011 – Thinking, fast and slow.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review]
problems:
  - I want the author, the year, and the title in my note names.
  - I want my notes to sort by author in the file explorer.
  - Two papers by the same author in the same year get the same note name.
keywords:
  - author year title
  - first author
  - file name
  - filename
  - note name
  - note title
  - output path
  - sort by author
audience: Readers who want to find a note by author and still see which work it is.
effort: Paste one line into your profile's note name. Notes you create from then on get the new name.
---

Each literature note is named by the family name of its first author, the year, and the title, such as `Kahneman 2011 – Thinking, fast and slow`. Notes sort by author, then year, in the file explorer.

- The first author is the first of the item's main creators: its authors, or, when it has none, its editors. An interview uses the person interviewed. An organization shows with its full name.
- An item with no creator or no date leaves that part out. With neither, the note is named by its title alone.
- Characters a file name cannot hold are changed, so every note is one file in your literature note folder. A colon in the title becomes a dash; a slash, a backslash, or a vertical bar becomes a hyphen; square brackets become round brackets; double quotes become single quotes; and `?`, `*`, `<`, `>`, `#`, and `^` are left out.
- When a note with the same name already exists, the new note gets a short random ending, such as `Kahneman 2011 – Thinking, fast and slow_a1B2c3`, so ZotLit can still create it.

To use it, open a literature note that uses your profile and run **Customize this note's template**. In the Template Workbench View, select the **Name and folder** tab and replace the text in **Note name template** with the line of this entry. **Preview** shows the name for the selected item. Notes you already have keep their names.
