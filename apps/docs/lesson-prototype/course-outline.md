# /learn course outline (draft cut)

Status: draft for the owner's read. Cut from the 13 drafted lessons on
`trial/lessons-on-next`. Not walked on `next` yet.

## Frame

- **Reader:** a non-technical academic, tired, on a desktop computer.
- **Assumed setup:** Obsidian 1.14.5 or later, Zotero 10, both on one computer.
- **One story for all six lessons:** you write `Chapter 3 - Presenting the
  results` of a thesis. Your Zotero collection `Reproducibility` holds the
  papers. The paper you work with is Sandve et al. 2013, "Ten Simple Rules for
  Reproducible Computational Research".
- **Budget per lesson:** 5 to 7 steps, about 40 words a step, about 10 minutes.
- **Each step has:** one action, one picture, one "you should see" check, and a
  fix for the likely failure behind "I see something else".
- **A lesson holds one guided run.** Other routes, settings, and edge cases go
  to recipes in `/docs`.

## Lesson 1. Connect Zotero to Obsidian and write your first literature note

Source: `connect-zotero-to-obsidian` (guided part), which already covers the
first run of `create-a-literature-note`.
Search intent: "connect zotero to obsidian", "how to use zotero with obsidian".

| # | Do | You should see |
|---|---|---|
| 1 | In Obsidian: Settings, Community plugins, Browse. Search ZotLit. Install, then Enable. | A tab named Zotero library opens. |
| 2 | Look at the first line of the tab. | Connect to Zotero has a green check and your item count. |
| 3 | Type a few words of a title into Search papers. Select the paper. | A card with the authors, the journal, and two buttons. |
| 4 | Select Open PDF. | The PDF in a new tab, with your Zotero highlights in colour. |
| 5 | Go back to the Zotero library tab. Select Write literature note. | The notice "Literature note created." and the note in a new tab. |
| 6 | Under the two links, type a heading and your own thoughts. | Your text above the Annotations section. |

- **Fixes behind "I see something else":** Zotero not found (Locate data
  folder); Obsidian installer too old; the button reads Open literature note.
- **Moved out:** go back to the passage (to Lesson 2); where files live, what
  ZotLit reads and changes (trust page); the Companion (see open facts).

## Lesson 2. Read and annotate a paper in Obsidian

Source: `annotate-pdfs-in-obsidian` lines 29–85.
Search intent: "annotate zotero pdfs in obsidian", "zotero highlights to obsidian".
Needs Zotero 10 open.

| # | Do | You should see |
|---|---|---|
| 1 | Open the paper's PDF from its card. | Annotation tools at the top right are dimmed. |
| 2 | Select the heading of the Zotero annotations sidebar. Choose Allow editing. | The toolbar shows Waiting for approval in Zotero. |
| 3 | In Zotero, choose Always Allow (not Allow). | A notice that editing is on. The tools are in colour. |
| 4 | Drag across a passage in the PDF. | A small toolbar under the passage. |
| 5 | Select Add comment, type a comment, select Highlight. | The passage turns yellow. A card appears in the sidebar. |
| 6 | Open the same PDF in Zotero. | The same highlight is there. |
| 7 | Open your literature note from Lesson 1. | The new highlight is in the Annotations section, with no update. |

- **Moved out:** find and filter annotations, edit a comment, link to a
  passage, another computer, locked annotations (recipes).

## Lesson 3. Cite while you write

Source: `cite-while-writing` lines 25–59 and 101–126, plus the engine install
from `export-to-word` lines 29–35.
Search intent: "how to cite in obsidian using zotero".

| # | Do | You should see |
|---|---|---|
| 1 | Settings, ZotLit, Citations. At Pandoc engine, select Install. | "Pandoc … is installed." You do this once per computer. |
| 2 | In your draft, type `[@sandve`. | A list of matching papers under the cursor. |
| 3 | Press Enter. | `[@sandve2013]` in your draft. |
| 4 | Before the bracket, type `, p. 2`. Move the cursor away. | (Sandve et al. 2013, 2) |
| 5 | Point at the citation. | The paper's full reference. |
| 6 | Open the PDF beside the draft. Drag a highlight's page label, such as p. 2, into the draft. | A quote block with the passage, its citation and page, and your comment. |

- **Moved out:** other ways to insert, the References sidebar, unresolved and
  ambiguous keys, the citation graph, citation settings (recipes).

## Lesson 4. Export your draft to Word with a reference list

Source: `export-to-word-with-a-bibliography` lines 24–117.
Search intent: "export obsidian to word with citations".
Needs Zotero open and the engine from Lesson 3.

| # | Do | You should see |
|---|---|---|
| 1 | Remove lines meant only for you, such as a to-do list. | A draft you can send. |
| 2 | Open the command palette (Ctrl+P or Cmd+P). Run Export note with citations. | A dialog. Format is Word document. |
| 3 | Choose the citation style you need, such as APA 7th edition. | "Only this export uses this style." |
| 4 | Select Export. | A notice with the file name and the style. |
| 5 | Open the Word file beside your note. | Formatted citations and a References list at the end. |

- **Fix to keep on the page:** Obsidian hides Word files; how to show them.
- **Moved out:** PDF, your own Pandoc, what counts as a citation, default
  styles (recipes).

## Lesson 5. Track what you have read

Source: `track-reading-status` lines 35–155. The "Unread" opening is cut.
Search intent: "track which papers I have read zotero obsidian".

| # | Do | You should see |
|---|---|---|
| 1 | In the Zotero library tab, select Save as query file. Name it Reading plan. | `Reading plan.zotquery` opens and lists your papers. |
| 2 | Select Views, Configure view. Set Layout to Table. | Your papers as rows. |
| 3 | Select Properties. Type `reading-status`. Select the second entry, Add "reading-status" vault property. | A column reading-status (note). Each cell reads No note. |
| 4 | Select a cell, type `to-read`, press Enter. | The notice "Literature note created." The cell shows to-read. |
| 5 | Mark a paper you started `reading` and a finished one `done`. | The cell suggests the statuses you used. |
| 6 | Select Filter. Choose reading-status (note), is, `to-read`. | Only the papers still to read. |

- **Moved out:** Unread, editing the status in the note, Bases (recipes).

## Lesson 6. Build a literature review table

Source: `build-a-literature-review-table` lines 26–132 and 156–165.
Search intent: "obsidian literature review table zotero".

| # | Do | You should see |
|---|---|---|
| 1 | Select the collection. Select Save as query file. Type Thesis as the folder. Save. | `Thesis/Reproducibility.zotquery` opens. |
| 2 | Select Views, Configure view. Set Layout to Table. | The papers as rows. |
| 3 | Select Properties. Add Year, Publication, and `creators`. Clear Item Type and Modified. | Authors, year, and journal beside each title. |
| 4 | Type `rating`. Select Add "rating" vault property. Type a rating in each cell. | Your ratings in a column of your own. |
| 5 | Select Sort, Add sort. Choose Date, old to new. | The papers in order of year. |
| 6 | Select the result count. Choose Copy to clipboard. Paste into your draft. | The table in your chapter. |

- **Moved out:** embed, group, rename a column, CSV, table syntax (recipes).

## Where the rest goes

- **Recipes in `/docs`:** keep-notes-updated, import-zotero-notes,
  keep-zotero-and-obsidian-in-sync, use-two-computers, fix-common-problems,
  find-a-paper-and-open-its-pdf, the returning-user parts of
  create-a-literature-note, and every "moved out" item above.
- **No lesson for two desk jobs:** "See how your sources connect" (graph) and
  "Make it yours" (templates). Both are recipes.

## Open facts, to settle in the walk on `next`

1. **Companion.** The Welcome checklist now has a fourth step, "Install ZotLit
   Companion — Recommended". Code reading: on Zotero 10 the default read mode
   clones the database with its write-ahead log, so recent changes are read
   without the Companion. Not walked on Windows or Linux.
2. **Citation keys.** Lesson 3 needs each paper to have a citation key. What a
   new Zotero 10 library has without Better BibTeX is not checked.
3. **First install.** Browse, Install, and automatic Zotero detection were never
   walked, because the Fixture installs the plugin. They need one manual walk.
4. **Product changes since the drafts:** Library View layout on a narrow pane,
   the annotation hover, the fourth Welcome step, the 2.2.1 "Update notes"
   route, drag from the PDF (2.2.2), page labels that follow the Reader
   settings (#1981).
5. **Lessons 5 and 6 share their first two steps.** Kept on purpose: each
   lesson must work alone.
