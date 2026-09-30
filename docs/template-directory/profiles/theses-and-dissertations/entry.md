---
tasks: [general-reading, literature-review]
itemTypes: [thesis]
features: [source-links, abstract, page-links, comments, images, color-highlights, own-notes, prompts, properties]
problems:
  - I want thesis notes that name the university and the thesis type.
  - How do I show the university of a thesis?
  - My thesis notes show the university as the publisher.
  - I want theses and dissertations to get their own template automatically.
  - My own notes get overwritten when the note updates.
  - Colors don't show in my notes.
keywords:
  - thesis
  - theses
  - dissertation
  - PhD thesis
  - doctoral thesis
  - master's thesis
  - university
  - thesis type
  - thesisType
  - grey literature
  - item type
  - itemType
  - match
  - colour
  - persist
  - Zotero Integration
audience: Readers of theses and dissertations who want each thesis note to name the thesis type and the university that awarded it.
effort: Import it, then create a note for a thesis. ZotLit chooses it for every thesis by itself; your color meanings are set once, in one file, and the ones it starts with work as they are.
---

**Update literature note** refreshes the part from Zotero; your three sections stay. To change the text under a highlight, edit its Zotero comment.

**Type** and **University** in Zotero give the thesis type and the university.

On update, `status` and the tags you add in Obsidian stay. Every other property takes the Zotero value. A Zotero tag with a comma or a `#` needs a manual fix in Obsidian. `venue` repeats the university, so one Bases view spans every look.

A change to the color meanings reaches every note that uses them.

With **Import match conditions** on, ZotLit uses this look for every thesis; off, you select it for each note. If another look also matches, ZotLit asks which to use.
