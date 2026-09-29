---
tasks: [literature-review]
features: [source-links, abstract, page-links, comments, images, color-highlights, grouped-by-color, own-notes, prompts, properties]
problems:
  - I want to read every paper for my review against the same questions.
  - I want a literature review table in Obsidian.
  - I want to track which papers I have read for my review.
  - I want my highlights sorted into aim, methods, findings, and limitations.
  - How do I build a literature matrix in Obsidian?
  - Colors don't show in my notes.
  - My own notes get overwritten when the note updates.
keywords:
  - literature review
  - systematic review
  - literature matrix
  - review table
  - synthesis
  - aim
  - methods
  - findings
  - limitations
  - relevance
  - contribution
  - reading status
  - group by color
  - colour sections
  - Bases
  - Dataview
  - persist
  - Zotero Integration
audience: Researchers writing a literature review who read many studies against the same questions and compare them in a table.
effort: Import it, then create a note. Highlight with the review colors below, or change the meanings once, in one partial, to match how you highlight.
---

A literature note for each study in your review. You read every study against the same five questions and write your answers at the top of its note; below them, your annotations are sorted into the parts of the study they come from. Its properties, among them your reading status and one line on each study's contribution, let you compare your sources side by side in a table.

Each note holds, from the top:

- the item's title, as the heading of the note. The note gets it once, when it is created; the `title` property keeps the current title;
- five headings for your own answers: **Aim**, **Methods**, **Findings**, **Limitations**, and **Relevance to my project**. The headings start empty;
- a **Source** heading, with one row of links back to the source: the item in Zotero, its PDF, its DOI, and its web page, each when the item has one;
- below the links, the abstract, folded, so it is at hand without taking over the note;
- your annotations under **Annotations**, in groups: one heading for each part of the study, such as **Methods** or **Limitations**, with every annotation of that part below it in page order. A part you did not highlight in the study gets no heading.

The groups come from your highlight colors, with the meanings of the **Color meanings for a literature review** partial, in this order:

| Zotero color | Group heading | What to highlight | Color in the note |
| --- | --- | --- | --- |
| Yellow | Aim | The research question, aim, or hypothesis | Orange |
| Blue | Methods | The design, sample, data, and analysis | Blue |
| Green | Findings | The results and conclusions | Green |
| Red | Limitations | Weaknesses, caveats, and threats to validity | Red |
| Orange | Gaps and future research | What the study leaves open | Orange |
| Magenta | Related work | Earlier studies worth following up | Purple |
| Purple | Definitions | Key terms and concepts | Purple |
| Gray | Quotes to use | Sentences to quote in your review | Gray |
| Plum (from Citavi only) | Paraphrases | Passages to paraphrase | Red |
| Any other color | Other highlights | | Blue |

Each annotation is a callout (Obsidian's colored box with an icon and a title) in the color Obsidian has that is nearest to its Zotero color, with no CSS snippet. Obsidian has no yellow or pink callout, so yellow shows orange, magenta shows purple, and plum shows red; the heading and the callout title tell them apart. The callout's title names the part and links to the annotation's page in the PDF, such as **Methods · p. 5**. A highlight quotes its text inside the callout, and your Zotero comment follows it as ordinary text. Image annotations appear as embedded images, and notes and text boxes you add in the PDF appear as their text. Every kind of annotation goes into the group of its color, so nothing is left out.

Four of your headings and four groups share a name: **Aim**, **Methods**, **Findings**, and **Limitations**. The heading on top holds your answer; the group below holds the passages you highlighted for it.

If you already highlight with other meanings, edit `zotlit-partial.color-meanings-review.md` in your template folder. Each color has one line, such as `{%- when "blue" -%} {%- assign callout = "info" -%} {%- assign meaning = "Methods" -%}`. Change only the words after `meaning =`, between the quotation marks, and use no quotation marks inside them: the group headings and the callout titles change together. The `colors` line, just below the comment at the top of that file, sets the order of the groups: move a color in that line to move its group, and keep a comma between each two colors. Every note under this profile follows the next time it updates, for example when you run **Create or update all literature notes**.

Everything else from Zotero, from **Source** down, sits in the part of the note that ZotLit refreshes when you update the note, between two marker lines, `%%zt-managed%%` and `%%/zt-managed%%`, that Obsidian hides in reading view. Leave the marker lines in place. Your five headings sit above that part, so an update never touches what you write there. The title heading sits above that part too: ZotLit writes it once, when it creates the note. If the title changes in Zotero, the `title` property follows on the next update, and you can change the heading by hand. To change the text of an annotation, edit its comment in Zotero; the comment appears under the highlight on the next update.

The note gets eight properties, ready for a review table in an Obsidian Bases view or with the Dataview plugin: one row per study, one column per property.

| Property | Value | When the note updates |
| --- | --- | --- |
| `title` | The item's title | Replace the existing value |
| `citekey` | The citation key | Replace the existing value |
| `tags` | The item's Zotero tags, with spaces changed to underscores | Add to the existing list |
| `year` | The year of publication | Replace the existing value |
| `venue` | The journal, book, or proceedings, or else the publisher or university | Replace the existing value |
| `status` | `unread`, until you change it, for example to `read` | Keep the existing value |
| `date-read` | Empty, for the date you finished the study | Keep the existing value |
| `contribution` | Empty, for one line on what the study adds to your review | Keep the existing value |

`status`, `date-read`, and `contribution` are yours: an update never changes a value you set. An empty property is intended: the note shows its name with no value, such as `contribution:`, ready for you to fill in. So that Obsidian shows a date picker for `date-read`, give it its type once: in a note, select the icon beside `date-read`, choose **Property type**, then **Date**.

Tags you add in Obsidian stay when the note updates. A tag you remove in Zotero stays in the note until you delete it from the note too. A property from Zotero is left out when the item has no value for it. Spaces in a Zotero tag become underscores. Other characters stay as they are, so a Zotero tag with a comma or a `#` in it needs a manual fix in Obsidian.

To use it, copy the entry or download its file, then run **Import profile…** in Obsidian. The import sheet shows the profile before anything is written. The profile brings its five building blocks (partials) with it: `links-row`, `folded-abstract`, `color-groups`, `color-meanings-review`, and `color-callout`.
