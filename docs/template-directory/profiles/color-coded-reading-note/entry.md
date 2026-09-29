---
tasks: [general-reading]
features: [source-links, abstract, page-links, comments, images, color-highlights, own-notes, properties]
problems:
  - Colors don't show in my notes.
  - My callouts are always gray.
  - I need a CSS snippet or another plugin before highlight colors show.
  - I want my highlight colors to show in Obsidian.
  - I want my notes to say what each highlight color means.
  - Highlights in a color I have not named get lost.
  - My own notes get overwritten when the note updates.
keywords:
  - colour
  - color coded
  - colored callouts
  - highlight colors
  - color legend
  - callouts
  - colorCategory
  - formattedAnnotations
  - persist
  - Zotero Integration
audience: Readers who highlight in Zotero with one color for each kind of passage and want each note to show the colors and what they mean.
effort: Import it, then create a note. You set your color meanings once, in one partial; the meanings it starts with work as they are.
---

A literature note that shows your annotations in colors that match your Zotero highlight colors, so the note reads like your marked-up PDF. The colors show in Obsidian with no CSS snippet and no extra plugin.

Each note holds:

- the item's title;
- one row of links back to the source: the item in Zotero, its PDF, its DOI, and its web page, each when the item has one;
- the abstract, folded, so it is at hand without taking over the note;
- your annotations in page order, each as a callout (Obsidian's colored box with an icon and a title) in the color that matches its Zotero color. The callout's title says what the color means and links to the annotation's page in the PDF, such as **Important · p. 5**. A highlight quotes its text inside the callout, and your Zotero comment follows it as ordinary text, so your words and the author's stay apart. Image annotations appear as embedded images, and notes and text boxes you add in the PDF appear as their text;
- a **My notes** heading for your own writing.

The profile starts with these color meanings:

| Zotero color | Meaning | Color in the note |
| --- | --- | --- |
| Yellow | Important | Orange |
| Red | Disagree | Red |
| Green | Agree | Green |
| Blue | Background | Blue |
| Purple | Definitions | Purple |
| Magenta | Examples | Purple |
| Orange | Questions | Orange |
| Gray | Quotes to use | Gray |
| Plum | Paraphrases | Red |
| Any other color | Other highlights | Blue |

Obsidian has no yellow or pink callout, so each Zotero color shows the nearest color Obsidian has: yellow highlights show orange, magenta shows purple, and plum shows red. The callout title tells them apart from orange, purple, and red highlights. A highlight in a color that is not on the list shows under **Other highlights**, so it stays in the note.

To give a color another meaning or another callout color, edit `zotlit-partial.color-meanings.md` in your template folder. Change only the words between the quotation marks. It is the one place the meanings live, so every note under this profile follows the next time it updates, for example when you run **Create or update all literature notes**. The **Color meanings** entry in the Template Directory lists the callout types and the color each one shows.

Everything from Zotero sits in the part of the note that ZotLit refreshes when you update the note. **My notes** sits outside it, so an update never touches what you write there. To change the text of an annotation, edit its comment in Zotero; the comment appears under the highlight on the next update.

The note gets six properties, ready to sort and filter in an Obsidian Bases view:

| Property | Value | When the note updates |
| --- | --- | --- |
| `title` | The item's title | Replace the existing value |
| `citekey` | The citation key | Replace the existing value |
| `tags` | The item's Zotero tags, with spaces changed to underscores | Add to the existing list |
| `year` | The year of publication | Replace the existing value |
| `venue` | The journal, book, or proceedings, or else the publisher or university | Replace the existing value |
| `status` | `unread` | Keep the existing value |

Tags you add in Obsidian stay when the note updates, and so does a `status` you change by hand. A tag you remove in Zotero stays in the note until you delete it from the note too. A property is left out when the item has no value for it. Spaces in a Zotero tag become underscores. Other characters stay as they are, so a Zotero tag with a comma or a `#` in it needs a manual fix in Obsidian.

To use it, copy the entry or download its file, then run **Import profile…** in Obsidian. The import sheet shows the profile before anything is written. The profile brings its four building blocks (partials) with it: `links-row`, `folded-abstract`, `color-meanings`, and `color-callout`.
