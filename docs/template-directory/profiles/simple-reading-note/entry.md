---
tasks: [general-reading]
features: [source-links, abstract, page-links, comments, images, own-notes, properties]
problems:
  - I just want a literature note that works, without learning templates.
  - I need a very simple template that imports my annotations from Zotero.
  - Where do I start with templates?
  - My own notes get overwritten when the note updates.
keywords:
  - starter
  - simple
  - basic
  - minimal
  - beginner
  - default
  - import template
  - literature note
  - annotations
  - highlights
  - persist
  - Zotero Integration
recommended: true
audience: Anyone who reads in Zotero and wants a clean literature note for every paper, book, or source, with no setup.
effort: Nothing. Import it, then create a note. Notes go into your own note folder and use your own citation style.
---

A literature note with the essentials and nothing else. It is the recommended place to start: import it, create a note for any Zotero item, and change it later only if you want more.

Each note holds:

- the item's title;
- one row of links back to the source: the item in Zotero, its PDF, its DOI, and its web page, each when the item has one;
- the abstract, folded, so it is at hand without taking over the note;
- your annotations in page order. A highlight shows as a plain quote with a link to its page in the PDF, and your Zotero comment follows it as ordinary text, so your words and the author's stay apart. Image annotations appear as embedded images. Highlights show the same whatever their color;
- a **My notes** heading for your own writing.

Everything from Zotero sits in the part of the note that ZotLit refreshes when you update the note. **My notes** sits outside it, so an update never touches what you write there. To change the text of an annotation, edit its comment in Zotero; the comment appears under the highlight on the next update.

The note gets six properties, ready for a Bases view:

| Property | Value | When the note updates |
| --- | --- | --- |
| `title` | The item's title | Replace the existing value |
| `citekey` | The citation key | Replace the existing value |
| `tags` | The item's Zotero tags, with spaces changed to underscores | Add to the existing list |
| `year` | The year of publication | Replace the existing value |
| `venue` | The journal, book, or proceedings, or else the publisher or university | Replace the existing value |
| `status` | `unread` | Keep the existing value |

Tags you add in Obsidian stay when the note updates, and so does a `status` you change by hand. A tag you remove in Zotero stays in the note until you delete it there too. A property is left out when the item has no value for it. A tag keeps any character other than a space as Zotero spells it, so a Zotero tag with a comma or a `#` in it needs a manual fix in Obsidian.

To use it, copy the entry or download its file, then run **Import profile…** in Obsidian. The import sheet shows the profile before anything is written. The profile brings three partials with it: `links-row`, `folded-abstract`, and `plain-annotation-quote`.
