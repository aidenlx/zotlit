# /learn course outline (draft cut)

Status: draft for the owner's read. Cut from the 13 drafted lessons on
`trial/lessons-on-next`. Walked on `next` (branch `docs/learn-walks`): all 36
steps pass against Obsidian 1.14.5 and Zotero 10.0. Step screenshots:
`apps/docs/public/img/learn/<lesson-slug>/step-<n>.webp` on that branch. The
tables below carry the walk's corrections.

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
| 3 | Type a few words of a title into Search papers. Select the paper. | A card under the list with the authors, the journal, and the buttons Open PDF and Write literature note. Scroll down if the buttons are out of view. |
| 4 | Select Open PDF. | The PDF in a new tab, at the page where you last read it in Zotero, with your highlights in colour. |
| 5 | Go back to the Zotero library tab. Select Write literature note. | The notice "Literature note created." and the note in a new tab. |
| 6 | Under the line with the Zotero and PDF links, type a heading and your own thoughts. | Your text above the Annotations section. |

- **Walk notes:** the first screen shows four setup steps; the fourth,
  "Install ZotLit Companion · Recommended", is optional and this lesson leaves
  it. Step 1 (Browse, Install) cannot be walked in the Fixture.

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
| 5 | Open the folder of your note in Finder or File Explorer. Open the Word file. | Formatted citations and a References list at the end. |

- **Walk note:** Obsidian's file list hides Word files by default, so the
  lesson sends the reader to the folder on the computer.
- **Moved out:** PDF, your own Pandoc, what counts as a citation, default
  styles (recipes).

## Lesson 5. Track what you have read

Source: `track-reading-status` lines 35–155. The "Unread" opening is cut.
Search intent: "track which papers I have read zotero obsidian".

| # | Do | You should see |
|---|---|---|
| 1 | In the Zotero library tab, select Save as query file. Name it Reading plan. | `Reading plan.zotquery` opens and lists your papers. |
| 2 | Select Views, Configure view. Set Layout to Table. | Your papers as rows. |
| 3 | Select Properties. Type `reading-status`. Select the second entry, Add "reading-status" vault property. | A column reading-status (note). A paper with no literature note reads No note; the paper from Lesson 1 has an empty cell. |
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
| 3 | Select Properties. Add Year, Publication, and `creators`. Clear Item Type and Modified. | The columns Year, Publication, and Creators (the authors) beside each title. |
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

## Facts from the walk

1. **Companion: not needed for this course.** On Zotero 10.0 in the default
   read mode, a change in Zotero reached Obsidian in about 3 seconds with the
   Companion turned off (about 2 seconds with it on). The message
   `companion_zotero_10_guidance` shows only to people who upgrade from before
   2.1.0 or from v1. Observed on macOS; Windows and Linux are not checked.
2. **Citation keys come from Zotero's own Citation Key field.** Better BibTeX
   is not needed to read them. Still open: what Lesson 3 shows for a paper with
   no key, and whether a new Zotero 10 library fills that field by itself.
3. **Not walkable in the Fixture:** Lesson 1 step 1 (Browse, Install, automatic
   Zotero detection), the Install press in Lesson 3 step 1 (the engine was
   already on the computer), and opening the file in Word in Lesson 4 step 5.
   Each needs one manual walk on a clean computer.
4. **Lessons 5 and 6 share their first two steps.** Kept on purpose: each
   lesson must work alone.

## Product frictions a first-time reader meets (not filed)

- At a 1440×860 window, the card's Open PDF and Write literature note buttons
  sit below the visible part of the tab, under the setup steps and the list.
- Open PDF opens at the last page read in Zotero, so the first page's
  highlights are out of view.
- Right after the new note opens, the annotation sidebar reads "Open a
  literature note or a Zotero PDF to see annotations."
- Save as query file suggests the name "Recent" from the default view.
- The Companion step can read "Recommended" when the Companion is loaded
  (seen in the Fixture; a real install is not checked).
- In the Reading plan table, the Title column is clipped after a column is
  added.
