---
tasks: [reading-books, general-reading]
itemTypes: [bookSection]
features: [source-links, abstract, page-links, comments, images, color-highlights, own-notes, prompts, properties]
problems:
  - I want chapter notes that name the book the chapter is in.
  - How do I show the book title and editors of a book chapter?
  - My chapter notes need the chapter's pages.
  - The editors of the book are missing from my chapter notes.
  - I want book chapters to get their own template automatically.
  - My own notes get overwritten when the note updates.
  - Colors don't show in my notes.
keywords:
  - book chapter
  - chapter
  - book section
  - bookSection
  - edited volume
  - edited book
  - anthology
  - handbook
  - collected essays
  - editors
  - book title
  - containerTitle
  - pages
  - item type
  - itemType
  - match
  - colour
  - persist
  - Zotero Integration
audience: Readers of chapters in edited books who want each chapter note to name the book, its editors, and the chapter's pages, so the chapter can be cited correctly.
effort: Import it, then create a note for a book chapter. ZotLit chooses it for every book chapter by itself; your color meanings are set once, in one file, and the ones it starts with work as they are.
---

A literature note made for chapters in edited books. Once you import it, ZotLit chooses it by itself whenever you create a note for a Zotero item of the type **Book Section**, the type Zotero uses for a book chapter. Articles, whole books, and every other kind of source keep the profile they use now.

Each note holds:

- the chapter's title;
- one line that names the book the chapter is in, the book's editors, and the chapter's pages, each when Zotero has it, such as **In *Judgment under Uncertainty: Heuristics and Biases*, edited by Daniel Kahneman, Paul Slovic, and Amos Tversky · pp. 3–20**;
- one row of links back to the source: the item in Zotero, its PDF, its DOI, and its web page, each when the item has one;
- the abstract, folded, so it is at hand without taking over the note;
- your annotations in page order, each as a callout (Obsidian's colored box with an icon and a title) in the color that matches its Zotero color. The callout's title says what the color means and links to the annotation's page in the PDF, such as **Important · p. 5**. A highlight quotes its text inside the callout, and your Zotero comment follows it as ordinary text, so your words and the author's stay apart. Image annotations appear as embedded images, and notes and text boxes you add in the PDF appear as their text;
- three empty sections for your own writing: **Summary**, **Key points**, and **My notes**.

Everything from Zotero sits in the part of the note that ZotLit refreshes when you update the note. The three sections sit outside it, so an update never touches what you write there. To change the text of an annotation, edit its comment in Zotero; the comment appears under the highlight on the next update.

The callout colors and their meanings are the same as in the **Color-coded reading note**: yellow is **Important** and shows orange, red is **Disagree**, green is **Agree**, blue is **Background**, purple is **Definitions**, magenta is **Examples** and shows purple, orange is **Questions**, gray is **Quotes to use**, and plum is **Paraphrases** and shows red. A highlight in any other color shows blue under **Other highlights**. To change a meaning, edit `zotlit-partial.color-meanings.md` in your template folder and change only the words between the quotation marks; the **Color meanings** entry in the Template Directory shows how. Every profile that uses these meanings follows on the next update.

The note gets these properties, ready to sort and filter in an Obsidian Bases view:

| Property | Value | When the note is updated |
| --- | --- | --- |
| `title` | The chapter's title | Replace the existing value |
| `citekey` | The citation key | Replace the existing value |
| `tags` | The item's Zotero tags, with spaces changed to underscores | Add to the existing list |
| `year` | The year of publication | Replace the existing value |
| `venue` | The title of the book, or else its publisher | Replace the existing value |
| `status` | `unread` | Keep the existing value |
| `book-title` | The title of the book | Replace the existing value |
| `editors` | The book's editors, one name per line | Replace the existing value |
| `pages` | The chapter's pages, such as `3–20` | Replace the existing value |

A property is left out when the chapter has no value for it. `venue` repeats the book's title on purpose: the other Directory profiles write `venue` too, so one Bases view can show the venue of every note, whichever profile wrote it. The last three come from the **Publication details by item type** property entry, unchanged. Tags you add in Obsidian stay when the note updates, and so does a `status` you change by hand. Spaces in a Zotero tag become underscores; other characters stay as they are, so a Zotero tag with a comma or a `#` in it needs a manual fix in Obsidian.

The chapter's authors and the book's editors are separate in Zotero: enter the editors as **Editor** in the chapter's item, and they show in the details line and in `editors`, apart from the chapter's authors.

To use it, copy the entry or download its file, then run **Import profile…** in Obsidian. The import sheet shows the profile before anything is written, with its condition in words: **Item type is Book Section**. Keep **Import match conditions** on to let ZotLit choose the profile for book chapters by itself. Turn it off to import the profile without its condition; ZotLit then never chooses it by itself, and you choose it when you create a note. If another profile of yours also matches book chapters, ZotLit asks which one to use. Notes you already have keep the profile that wrote them.

The **Books** and **Theses and dissertations** profiles work the same way for their own kinds of source, so you can import all three: each takes only its own item type. The profile brings its five building blocks (partials) with it: `publication-details`, `links-row`, `folded-abstract`, `color-meanings`, and `color-callout`.
