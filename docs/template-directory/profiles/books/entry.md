---
tasks: [reading-books]
itemTypes: [book]
features: [source-links, abstract, page-links, comments, images, color-highlights, own-notes, prompts, properties]
problems:
  - I want a template for books, not articles.
  - My book notes need the publisher, place, edition, and ISBN.
  - I want sections for a summary, key points, and ideas to explore in every book note.
  - My own notes get overwritten when the note updates.
  - I want books to get their own template automatically.
  - My book notes show "Vol. null" or an empty journal.
  - Colors don't show in my notes.
keywords:
  - book
  - books
  - monograph
  - textbook
  - reading notes
  - book notes
  - publisher
  - place
  - edition
  - ISBN
  - item type
  - itemType
  - match
  - colour
  - persist
  - Zotero Integration
audience: Readers of books who want each book note to carry the book's publication details and to leave room for their own summary, key points, and ideas to explore.
effort: Import it, then create a note for a book. ZotLit chooses it for every book by itself; your color meanings are set once, in one file, and the ones it starts with work as they are.
---

A literature note made for books. Once you import it, ZotLit chooses it by itself whenever you create a note for a Zotero item of the type **Book**. Articles, chapters, and every other kind of source keep the profile they use now.

Each note holds:

- the book's title;
- one line with its publication details: the publisher, place, edition, and ISBN, each when Zotero has it, such as **Penguin Books · London · ISBN 978-0-14-103357-0**. An edition shows as it is written in Zotero, such as **Edition: 2nd**;
- one row of links back to the source: the item in Zotero, its PDF, its DOI, and its web page, each when the item has one;
- the abstract, folded, so it is at hand without taking over the note;
- your annotations in page order, each as a callout (Obsidian's colored box with an icon and a title) in the color that matches its Zotero color. The callout's title says what the color means and links to the annotation's page in the PDF, such as **Important · p. 5**. A highlight quotes its text inside the callout, and your Zotero comment follows it as ordinary text, so your words and the author's stay apart. Image annotations appear as embedded images, and notes and text boxes you add in the PDF appear as their text;
- three empty sections for your own writing: **Summary**, **Key points**, and **Ideas to explore**.

Everything from Zotero sits in the part of the note that ZotLit refreshes when you update the note. The three sections sit outside it, so an update never touches what you write there. To change the text of an annotation, edit its comment in Zotero; the comment appears under the highlight on the next update.

The callout colors and their meanings are the same as in the **Color-coded reading note**: yellow is **Important** and shows orange, red is **Disagree**, green is **Agree**, blue is **Background**, purple is **Definitions**, magenta is **Examples** and shows purple, orange is **Questions**, gray is **Quotes to use**, and plum is **Paraphrases** and shows red. A highlight in any other color shows blue under **Other highlights**. To change a meaning, edit `zotlit-partial.color-meanings.md` in your template folder and change only the words between the quotation marks; the **Color meanings** entry in the template directory shows how. Every profile that uses these meanings follows on the next update.

The note gets these properties, ready to sort and filter in an Obsidian Bases view:

| Property | Value | When the note is updated |
| --- | --- | --- |
| `title` | The book's title | Replace the existing value |
| `citekey` | The citation key | Replace the existing value |
| `tags` | The item's Zotero tags, with spaces changed to underscores | Add to the existing list |
| `year` | The year of publication | Replace the existing value |
| `venue` | The publisher | Replace the existing value |
| `status` | `unread` | Keep the existing value |
| `publisher` | The publisher | Replace the existing value |
| `place` | The place of publication | Replace the existing value |
| `edition` | The edition, as written in Zotero | Replace the existing value |
| `isbn` | The ISBN | Replace the existing value |

A property is left out when the book has no value for it. `venue` repeats the publisher on purpose: the other profiles in the template directory write `venue` too, so one Bases view can show the publication of every note, whichever profile wrote it. The last four come from the **Publication details by item type** property entry, unchanged. Tags you add in Obsidian stay when the note updates, and so does a `status` you change by hand. Spaces in a Zotero tag become underscores; other characters stay as they are, so a Zotero tag with a comma or a `#` in it needs a manual fix in Obsidian.

The import sheet shows the profile's condition in words: **Item type is Book**. Keep **Import match conditions** on to let ZotLit choose the profile for books by itself. Turn it off to import the profile without its condition; ZotLit then never chooses it by itself, and you choose it when you create a note. If another profile of yours also matches books, ZotLit asks which one to use. Notes you already have keep the profile that wrote them.

The **Book chapters** and **Theses and dissertations** profiles work the same way for their own kinds of source, so you can import all three: each takes only its own item type.
