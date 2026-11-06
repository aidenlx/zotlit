---
title: Template workbench panels
---
# Template workbench panels

This page checks the two side panels of the Template Workbench View, and the
standalone Template Data Explorer. The Fields panel sits on the left of the
editor and lists the template fields of the chosen Item. The Preview sits on
the right and shows the note that the editor's own render makes for that Item.
Both are in the same tab as the editor.

Use the Scope Case `all`. Open `templates/zotlit-profile.books.md` and run
**Switch to template workbench view**. Close any other Template Workbench tab
before each case.

## The view opens without panels

1. Open the Books Profile as above.

Expected: the editor fills the tab. The **Show preview** and **Show fields**
view actions are not pressed. The pane menu shows **Show preview** and **Show
fields** without a check mark and has no Preview settings.

## Show and hide the Preview

1. Select the **Show preview** view action.
2. Select it again.

Expected: after step 1, a region named "Preview" opens on the right and the
action is pressed. The pane menu shows **Show preview** checked, followed by
**Preview as new note**, **Preview as updated note**, **Preview updated
section only**, **Automatically refresh preview** and **Show Markdown**.
After step 2, the region closes, and the chosen Item stays chosen.

## Show and hide the Fields

1. Select the **Show fields** view action.
2. Select it again.

Expected: after step 1, a region named "Fields" opens on the left and the
action is pressed; the pane menu shows **Show fields** checked. After step 2,
the region closes, and the chosen Item stays chosen.

## One Item in every surface

1. Show the Preview and the Fields.
2. Select **Choose item** in the view header, and choose "Alpha of the
   personal library".
3. Select **Choose item** in the Preview panel, and choose "Beta of the
   shared reading group".
4. Select **Choose item** in the Fields panel, and choose "Alpha of the
   personal library".

Expected: after each choice, the editor header, the Properties tab
(`fixture-title`), the Name and folder tab (`books-personalAlpha2024`, then
`books-sharedReadingBeta2022`), the Fields panel caption and the Preview panel
("Book profile: …") all name the same Item.

## The Fields follow the editor

1. Show the Fields, and choose "Alpha of the personal library".
2. Open the Annotation tab.
3. In the Fields panel, select **Back to note root**.
4. Open the Name and folder tab, then the Annotation tab again.
5. Select **Back to note root** again, then choose "Beta of the shared reading
   group".

Expected: after step 2, the Fields panel shows the Annotation root of the
chosen annotation. After step 3, it shows the Note root, and the editor stays
on the Annotation tab. In step 4, the panel follows the editor: the Note name
root with the Name and folder tab, then the Annotation root with the
Annotation tab. After step 5, the new Item starts the panel over at the
editor's Annotation root. A filter typed
in the panel and the sections closed in it stay while the Item stays.

## Insert a field from the Fields

1. Show the Fields, and choose "Alpha of the personal library".
2. Select **Source**, and place the cursor in the note body.
3. In the Fields panel, open the row menu of `title`. Select **Insert field**.
4. Open the row menu of `title` again.

Expected: step 3 writes `{{ zt.title }}` at the cursor and gives the editor
the focus. In step 4, the menu also offers **Copy path**, **Copy value** and
the Template Snippets, each of which copies to the clipboard.

## Export from the Fields

1. Show the Fields, choose "Alpha of the personal library", and open the
   Annotation tab.
2. Open the pane menu.
3. In the Fields panel, select **Back to note root**. Open the pane menu
   again, and select **Save template data as JSON**.

Expected: in step 2 the pane menu offers **Export selected paper data**, as
the paper has no annotations. In step 3 it offers **Save template data as
JSON**, and the saved file holds the Note root the panel shows, not the
editor's Annotation root. With the Fields hidden, the entry exports the
editor's own root.

## Resize the Preview

1. Show the Preview.
2. Drag the edge between the editor and the Preview to the left.
3. Press `Tab` until the edge has the focus. Press `ArrowLeft`, then
   `Shift+ArrowLeft`, then `Home`, then `End`.

Expected: the drag widens the Preview. With the keyboard, `ArrowLeft` widens
it by 16 pixels and `Shift+ArrowLeft` by 64 pixels; `Home` makes it as narrow
as it can be (240 pixels), and `End` as wide as the tab allows: 960 pixels, or
40% of the tab when that is less. The Preview never takes more than 40% of the
tab, and a screen reader reads the width the panel has.

## The panels survive a restart

1. Show the Preview and widen it.
2. Reload Obsidian (**Reload app without saving**).

Expected: the Books Profile opens with the Preview shown, at the same width.

## A narrow tab stacks the Preview

1. Show the Preview.
2. Make the tab narrower than 640 pixels, for example by opening the left
   sidebar and splitting the tab.

Expected: the Preview moves below the editor and the edge handle hides. The
source stays in view above it.

## Preview settings

1. Show the Preview, and choose "Alpha of the personal library".
2. In the pane menu, select **Automatically refresh preview** to clear it,
   then edit the note body.
3. Select **Run** in the Preview panel.
4. Select **Preview updated section only**, then **Show Markdown**.

Expected: after step 2, the caption reads "On demand" and the panel says the
preview is behind your edits. Step 3 renders the edit. In step 4, the panel
shows the part of the note kept up to date, then its Markdown source.

## A problem reaches the editor

1. Show the Preview, and choose "Alpha of the personal library".
2. In the note body, change `{% render "book-details" with zt as zt %}` to
   `{% render "missing-partial" %}`.

Expected: the Problems area at the bottom of the editor names the missing
partial once. **Show problem** in the Preview panel opens that problem.

## Other document kinds

1. Open `templates/zotlit-citation.md` in the Template Workbench View and show
   the Preview.
2. Open `templates/zotlit-partial.book-details.md` the same way and show the
   Preview.

Expected: the Citation Template shows "Citation preview" and its pane menu
offers the example set and the two citation variants. The Shared Partial shows
"Partial preview" and its pane menu offers the three callers.

## Open template workbench

1. Show nothing; run **Open template workbench** from the pane menu.

Expected: the editor moves to a window of its own with the Fields and the
Preview shown, and no Template Data Explorer tab opens beside it. A second
**Open template workbench** reveals that window and opens no second one.

## The standalone Template Data Explorer

1. Open the Books Profile, show the Fields, and choose "Alpha of the personal
   library".
2. Run **Open template data explorer** from the command palette, and choose
   "Beta of the shared reading group" in it.
3. In the editor, choose "Within-library duplicate, first item".
4. Switch between the editor tab and a normal note.

Expected: step 2 opens the explorer in the right sidebar on its own Item; the
editor and its Fields panel keep "Alpha of the personal library". Step 3
leaves the explorer on "Beta of the shared reading group". In step 4 the
explorer stays where it is. Its rows offer copy and Template Snippets, and no
**Insert field**. **Explore template data** on a Literature Note's file menu,
and the Zotero `explore` action, open the same standalone explorer.

## A saved Fields pane restores as the standalone explorer

1. Make the leaf an older ZotLit saved for a linked Fields pane. Open the
   developer console and run
   `app.workspace.getRightLeaf(false).setViewState({ type: "zotlit-template-data-explorer", state: { itemIndexedKey: "AAAAAAAA", root: "note", sourceFile: "templates/zotlit-profile.books.md" } })`
2. Reload Obsidian (**Reload app without saving**).
3. Open the Books Profile, and choose "Beta of the shared reading group".

Expected: after step 2, the explorer shows "Alpha of the personal library"
with no **Insert field** on its rows. In step 3 the editor's choice leaves the
explorer on its own Item. The file the old pane named, and its link group, have
no effect.
