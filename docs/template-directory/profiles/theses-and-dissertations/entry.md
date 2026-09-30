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

**Update literature note** refreshes the part from Zotero; your three sections stay. To change the text under a highlight, edit its comment in Zotero.

The thesis type and the university come from the **Type** and **University** fields of the Zotero item.

On update, `status` and the tags you add in Obsidian stay. Every other property takes the Zotero value. A Zotero tag with a comma or a `#` needs a manual fix in Obsidian.

A change to the color meanings reaches every note that uses them.

With **Import match conditions** on, ZotLit uses this look for every thesis. Turn it off to select it for each note yourself. If another look also matches theses, ZotLit asks which to use.
