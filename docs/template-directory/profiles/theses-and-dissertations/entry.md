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

A literature note made for theses and dissertations. Once you import it, ZotLit chooses it by itself whenever you create a note for a Zotero item of the type **Thesis**, the type Zotero uses for theses and dissertations alike. Articles, books, and every other kind of source keep the profile they use now.

Each note holds:

- the thesis's title;
- one line with the thesis type and the university, each when Zotero has it, such as **PhD thesis · University of Oxford**. Zotero keeps them in the thesis's **Type** and **University** fields;
- one row of links back to the source: the item in Zotero, its PDF, its DOI, and its web page, each when the item has one;
- the abstract, folded, so it is at hand without taking over the note;
- your annotations in page order, each as a callout (Obsidian's colored box with an icon and a title) in the color that matches its Zotero color. The callout's title says what the color means and links to the annotation's page in the PDF, such as **Important · p. 5**. A highlight quotes its text inside the callout, and your Zotero comment follows it as ordinary text, so your words and the author's stay apart. Image annotations appear as embedded images, and notes and text boxes you add in the PDF appear as their text;
- three empty sections for your own writing: **Summary**, **Key points**, and **My notes**.

Everything from Zotero sits in the part of the note that ZotLit refreshes when you update the note. The three sections sit outside it, so an update never touches what you write there. To change the text of an annotation, edit its comment in Zotero; the comment appears under the highlight on the next update.

The callout colors and their meanings are the same as in the **Color-coded reading note**: yellow is **Important** and shows orange, red is **Disagree**, green is **Agree**, blue is **Background**, purple is **Definitions**, magenta is **Examples** and shows purple, orange is **Questions**, gray is **Quotes to use**, and plum is **Paraphrases** and shows red. A highlight in any other color shows blue under **Other highlights**. To change a meaning, edit `zotlit-partial.color-meanings.md` in your template folder and change only the words between the quotation marks; the **Color meanings** entry in the template directory shows how. Every profile that uses these meanings follows on the next update.

The note gets these properties, ready to sort and filter in an Obsidian Bases view:

| Property | Value | When the note is updated |
| --- | --- | --- |
| `title` | The thesis's title | Replace the existing value |
| `citekey` | The citation key | Replace the existing value |
| `tags` | The item's Zotero tags, with spaces changed to underscores | Add to the existing list |
| `year` | The year of the thesis | Replace the existing value |
| `venue` | The university | Replace the existing value |
| `status` | `unread` | Keep the existing value |
| `university` | The university | Replace the existing value |
| `thesis-type` | The thesis type, such as `PhD thesis` | Replace the existing value |

A property is left out when the thesis has no value for it. `venue` repeats the university on purpose: the other profiles in the template directory write `venue` too, so one Bases view can show the publication of every note, whichever profile wrote it. The last two come from the **Publication details by item type** property entry, unchanged. Tags you add in Obsidian stay when the note updates, and so does a `status` you change by hand. Spaces in a Zotero tag become underscores; other characters stay as they are, so a Zotero tag with a comma or a `#` in it needs a manual fix in Obsidian.

The import sheet shows the profile's condition in words: **Item type is Thesis**. Keep **Import match conditions** on to let ZotLit choose the profile for theses by itself. Turn it off to import the profile without its condition; ZotLit then never chooses it by itself, and you choose it when you create a note. If another profile of yours also matches theses, ZotLit asks which one to use. Notes you already have keep the profile that wrote them.

The **Books** and **Book chapters** profiles work the same way for their own kinds of source, so you can import all three: each takes only its own item type.
