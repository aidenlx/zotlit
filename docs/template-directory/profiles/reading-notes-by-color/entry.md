---
tasks: [general-reading, writing]
features: [source-links, abstract, page-links, comments, images, color-highlights, grouped-by-color, own-notes, prompts, properties]
problems:
  - I want my highlights grouped by color.
  - I want a heading for each highlight color, with the highlights of that color below it.
  - I want my own takeaways at the top of the note and the highlights below.
  - I want a Zettelkasten literature note.
  - Colors don't show in my notes.
  - The color headings repeat or get mixed up when I import again.
  - My own notes get overwritten when the note updates.
keywords:
  - Zettelkasten
  - literature note
  - takeaways
  - claims
  - group by color
  - grouped by colour
  - colour sections
  - heading per color
  - colored callouts
  - color legend
  - colorCategory
  - persist
  - isFirstImport
  - Zotero Integration
audience: Readers who write their own takeaways and claims first, Zettelkasten style, and want the highlights that support them sorted by color meaning below.
effort: Import it, then create a note. You set your color meanings once, in one partial; the meanings it starts with work as they are.
---

A literature note in two parts: your own thinking on top, and the source below it, with your annotations sorted by what their color means. It suits a Zettelkasten, where you write each idea from a source in your own words and keep the highlights that back it up close at hand.

Each note holds, from the top:

- three headings for your own writing: **Key takeaways**, the points to keep from the source; **My claims and ideas**, the ideas it gives you, each a candidate for a note of its own; and **Connections**, the notes and sources it links to. The headings start empty;
- the item's title, as a heading;
- one row of links back to the source: the item in Zotero, its PDF, its DOI, and its web page, each when the item has one;
- the abstract, folded, so it is at hand without taking over the note;
- your annotations under **Annotations**, in groups: one heading for each color meaning, such as **Definitions** or **Questions**, with every annotation of that meaning below it in page order. A meaning you did not use in the source gets no heading.

Each annotation is a callout (Obsidian's colored box with an icon and a title) in the color that matches its Zotero color. The callout's title says what the color means and links to the annotation's page in the PDF, such as **Important · p. 5**. A highlight quotes its text inside the callout, and your Zotero comment follows it as ordinary text, so your words and the author's stay apart. Image annotations appear as embedded images, and notes and text boxes you add in the PDF appear as their text. Every kind of annotation goes into the group of its color, so nothing is left out.

The profile starts with the color meanings of the **Color meanings** partial, and the groups come in this order:

| Zotero color | Group heading | Color in the note |
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

Obsidian has no yellow or pink callout, so each Zotero color shows the nearest color Obsidian has: yellow highlights show orange, magenta shows purple, and plum shows red. The group heading and the callout title tell them apart. Annotations in a color that is not on the list, such as a custom color from another app, come last, under **Other highlights**.

To give a color another meaning, edit `zotlit-partial.color-meanings.md` in your template folder. Change only the words between the quotation marks. It is the one place the meanings live, so the group headings and the callout titles change together, in every note under this profile, the next time the note updates, for example when you run **Create or update all literature notes**. Two colors with the same meaning share one group.

Everything from Zotero, from the title down, sits in the part of the note that ZotLit refreshes when you update the note. New annotations go into their groups, and a group appears when its first annotation does. Your three headings sit above that part, so an update never touches what you write there. To change the text of an annotation, edit its comment in Zotero; the comment appears under the highlight on the next update.

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

To use it, copy the entry or download its file, then run **Import profile…** in Obsidian. The import sheet shows the profile before anything is written. The profile brings its five building blocks (partials) with it: `links-row`, `folded-abstract`, `color-groups`, `color-meanings`, and `color-callout`.
