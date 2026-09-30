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
effort: Paste one line into the "Note name" field of your profile. Notes you create from then on get the new name.
---

Each literature note is named by the family name of its first author, the year, and the title, such as `Kahneman 2011 – Thinking, fast and slow`. When the file explorer sorts by name, notes sort by author, then year. The title tells apart two works by the same author in the same year.

- The first author is the first of the item's main creators: its authors. An item with no authors uses its editors, then its directors, then its contributors. An interview uses the person interviewed. An organization shows with its full name.
- An item with no creator or no date leaves that part out. With neither, the note is named by its title alone.
- Characters a file name cannot hold are changed, so every note is one file in your literature note folder. A colon in the title becomes a hyphen; a slash, a backslash, or a vertical bar becomes a hyphen; square brackets become round brackets; double quotes become single quotes; and `?`, `*`, `<`, `>`, `#`, and `^` are left out.
- When a note with the same name already exists, the new note gets a short random ending, such as `Kahneman 2011 – Thinking, fast and slow_a1B2c3`, so ZotLit can still create it.

In the **Name and folder** tab, **Preview** shows the name for the selected item, as it is when no other note has that name. Notes you already have keep their names.
