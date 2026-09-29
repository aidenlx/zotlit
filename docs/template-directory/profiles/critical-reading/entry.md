---
tasks: [close-reading]
features: [source-links, abstract, page-links, comments, images, color-highlights, grouped-by-color, own-notes, prompts, properties]
problems:
  - I want to read a text at the level of its argument.
  - I want to write down the main thesis, the key definitions, and my objections.
  - I want my highlights sorted into claims, definitions, arguments, and objections.
  - I want to collect the key quotes of a text in one place.
  - Colors don't show in my notes.
  - My own notes get overwritten when the note updates.
keywords:
  - critical reading
  - close reading
  - argument
  - argument mapping
  - thesis
  - claims
  - definitions
  - objections
  - critique
  - philosophy
  - law
  - theory
  - key quotes
  - group by color
  - colour sections
  - persist
  - Zotero Integration
audience: Readers in philosophy, law, theory, and other fields who read a text for its argument, what it claims, how it argues, and where it is open to doubt.
effort: Import it, then create a note. Highlight with the argument colors below, or change the meanings once, in one partial, to match how you highlight.
---

A literature note for reading an argument closely. You write the argument out at the top of the note, in your own words; below it, your annotations are sorted by the role each passage plays in the argument.

Each note holds, from the top:

- the item's title, as the heading of the note. The note gets it once, when it is created; the `title` property keeps the current title;
- five headings for your own writing: **Main thesis**, **Key definitions**, **Arguments**, **Objections and doubts**, and **Key quotes**. The headings start empty;
- a **Source** heading, with one row of links back to the source: the item in Zotero, its PDF, its DOI, and its web page, each when the item has one;
- below the links, the abstract, folded, so it is at hand without taking over the note;
- your annotations under **Annotations**, in groups: one heading for each role, such as **Definitions** or **Objections**, with every annotation of that role below it in page order. A role you did not highlight in the text gets no heading.

The groups come from your highlight colors, with the meanings of the **Color meanings for critical reading** partial, in this order:

| Zotero color | Group heading | What to highlight | Color in the note |
| --- | --- | --- | --- |
| Yellow | Main claims | The claims the author sets out to defend | Orange |
| Purple | Definitions | How the author defines key terms | Purple |
| Green | Arguments | Reasons and evidence for the claims | Green |
| Red | Objections | Passages you doubt or disagree with | Red |
| Orange | Unclear points | Passages you do not follow yet | Orange |
| Magenta | Examples | Cases and examples | Purple |
| Blue | Other views | Positions of others that the author takes up | Blue |
| Gray | Quotes to use | Sentences to quote in your own writing | Gray |
| Plum (from Citavi only) | Paraphrases | Passages to paraphrase | Red |
| Any other color | Other highlights | | Blue |

Each annotation is a callout (Obsidian's colored box with an icon and a title) in the color Obsidian has that is nearest to its Zotero color, with no CSS snippet. Obsidian has no yellow or pink callout, so yellow shows orange, magenta shows purple, and plum shows red; the heading and the callout title tell them apart. The callout's title names the role and links to the annotation's page in the PDF, such as **Definitions · p. 5**. A highlight quotes its text inside the callout, and your Zotero comment follows it as ordinary text, so your objections and the author's words stay apart. Image annotations appear as embedded images, and notes and text boxes you add in the PDF appear as their text. Every kind of annotation goes into the group of its color, so nothing is left out.

Your headings on top and the groups below follow the same argument: you write the main thesis from the **Main claims**, the key definitions from the **Definitions**, your account of the **Arguments** from the passages of that name, your objections and doubts from the **Objections** and **Unclear points**, and your key quotes from the **Quotes to use**.

If you already highlight with other meanings, edit `zotlit-partial.color-meanings-argument.md` in your template folder. Each color has one line, such as `{%- when "red" -%} {%- assign callout = "failure" -%} {%- assign meaning = "Objections" -%}`. Change only the words after `meaning =`, between the quotation marks, and use no quotation marks inside them: the group headings and the callout titles change together. The `colors` line, just below the comment at the top of that file, sets the order of the groups: move a color in that line to move its group, and keep a comma between each two colors. Every note under this profile follows the next time it updates, for example when you run **Create or update all literature notes**.

Everything else from Zotero, from **Source** down, sits in the part of the note that ZotLit refreshes when you update the note, between two marker lines, `%%zt-managed%%` and `%%/zt-managed%%`, that Obsidian hides in reading view. Leave the marker lines in place. Your five headings sit above that part, so an update never touches what you write there. The title heading sits above that part too: ZotLit writes it once, when it creates the note. If the title changes in Zotero, the `title` property follows on the next update, and you can change the heading by hand. To change the text of an annotation, edit its comment in Zotero; the comment appears under the highlight on the next update.

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

To use it, select **Import into Obsidian** on this page. If the import sheet does not open, select **Copy profile** or **Download file**, then run **Import profile…** in Obsidian. The import sheet shows the profile before anything is written. The profile brings its five building blocks (partials) with it: `links-row`, `folded-abstract`, `color-groups`, `color-meanings-argument`, and `color-callout`.
