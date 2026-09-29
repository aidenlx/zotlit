---
tasks: [teaching]
features: [source-links, abstract, page-links, comments, images, own-notes, prompts, properties]
problems:
  - I want notes for the readings on my syllabus.
  - I want each reading note to say which course and week it is for.
  - I want to see which readings I have done.
  - I want sections for a summary, key points, and discussion questions.
  - My course and week get overwritten when the note updates.
  - My own notes get overwritten when the note updates.
keywords:
  - course
  - class
  - seminar
  - lecture
  - syllabus
  - reading list
  - week
  - module
  - student
  - teacher
  - teaching
  - discussion questions
  - seminar questions
  - status
  - reading status
  - persist
  - Zotero Integration
audience: Students and teachers who read for a course and want every reading note to show its course, its week, and whether it is read, with room to prepare for the discussion.
effort: Import it, then choose it when you create a note for a reading. You type the course and the week once in each note's properties.
---

A literature note for the readings of a course, for students who prepare for a class and teachers who plan one. Each note says which course and week the reading is for, tracks whether you have read it, and gives you room to prepare for the discussion.

Each note holds:

- the reading's title;
- one row of links back to the source: the item in Zotero, its PDF, its DOI, and its web page, each when the item has one;
- the abstract, folded, so it is at hand without taking over the note;
- your annotations in page order. A highlight shows as a plain quote with a link to its page in the PDF, and your Zotero comment follows it as ordinary text, so your words and the author's stay apart. Image annotations appear as embedded images, and notes you add in the PDF appear as plain lines with their page link. Highlights show the same whatever their color;
- three empty sections for your own writing: **Summary**, **Key points**, and **Discussion questions**.

Everything from Zotero sits in the part of the note that ZotLit refreshes when you update the note. The three sections sit outside it, so an update never touches what you write there. To change the text of an annotation, edit its comment in Zotero; the comment appears under the highlight on the next update.

The note gets these properties, ready to sort and filter in an Obsidian Bases view:

| Property | Value | When the note updates |
| --- | --- | --- |
| `title` | The reading's title | Replace the existing value |
| `authors` | The reading's authors | Replace the existing value |
| `year` | The year of publication | Replace the existing value |
| `venue` | The journal, book, or proceedings, or else the publisher or university | Replace the existing value |
| `citekey` | The citation key | Replace the existing value |
| `tags` | The item's Zotero tags, with spaces changed to underscores | Add to the existing list |
| `course` | Empty: you type the course, such as `HIST 210` | Keep the existing value |
| `week` | Empty: you type the week, such as `3` | Keep the existing value |
| `status` | `unread` | Keep the existing value |

`course` and `week` start empty, and an update never changes what you type in them, so you fill them in once for each reading. `status` starts at `unread`; change it by hand, for example to `reading` or `read`, and an update keeps your value. A Bases view that filters on `course` and sorts by `week` then shows a course's reading list in order, with the status of each reading. To sort weeks 1 to 12 in number order, give `week` its type once: in a note, select the icon beside `week`, choose **Property type**, then **Number**. Obsidian then uses that type in every note.

Tags you add in Obsidian stay when the note updates. A tag you remove in Zotero stays in the note until you delete it from the note too. A property from Zotero is left out when the item has no value for it. Spaces in a Zotero tag become underscores. Other characters stay as they are, so a Zotero tag with a comma or a `#` in it needs a manual fix in Obsidian.

ZotLit never chooses this profile by itself: the import sheet shows **Not auto-selected**, and your other profiles keep the items they take now. When you create a note for a reading, ZotLit asks which profile to use; choose **Course reading**. If another profile of yours already takes the item, ZotLit creates the note with that profile; then run **Switch literature note profile** from the note and choose **Course reading**.

To use it, copy the entry or download its file, then run **Import profile…** in Obsidian. The import sheet shows the profile before anything is written. The profile brings its three building blocks (partials) with it: `links-row`, `folded-abstract`, and `plain-annotation-quote`.
