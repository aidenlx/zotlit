---
title: Template workbench panels
---
# Template workbench panels

This page checks the two side panels of the Template Workbench View, and the
standalone Template Data Explorer. The Fields panel sits on the left of the
editor and lists the template fields of the chosen Item. The Preview sits on
the right and shows the note that the editor's own render makes for that Item.
Both are in the same tab as the editor. When the tab is too narrow for a
column, the Preview moves under the editor. The editor keeps at least 360
pixels of width beside a column, and the Preview takes the right side before
the Fields panel.

Use the Scope Case `all`. Open `templates/zotlit-profile.books.md` and run
**Switch to template workbench view**. Close any other Template Workbench tab
before each case.

## The view opens without panels

1. Open the Books Profile as above.

Expected: the editor fills the tab. The **Show preview** and **Show fields**
view actions are not pressed. The pane menu shows **Show fields** and, below
it, **Show preview**, both without a check mark, and has no Preview settings.

## Show and hide the Preview

1. Select the **Show preview** view action.
2. Select it again.

Expected: after step 1, a region named "Preview" opens on the right and the
action is pressed. The pane menu shows **Show preview** checked, followed by
**Resize preview**, **Preview as new note**, **Preview as updated note**, **Preview updated
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
40% of the tab when that is less, or the width that keeps the editor 360
pixels wide beside the columns when that is less again. The Preview never
takes more than 40% of the tab, and a screen reader reads the width the panel
has and the largest width it can take.

## The panels survive a restart

1. Show the Preview and widen it.
2. Reload Obsidian (**Reload app without saving**).

Expected: the Books Profile opens with the Preview shown, at the same width.

## A narrow tab puts the Preview under the editor

1. Show the Preview at its initial width.
2. Make the tab narrower than 600 pixels, for example by splitting it to the
   right and dragging the split.

Expected: the Preview moves under the editor and takes 40% of the tab's
height. A horizontal handle sits between the editor and the Preview. The
source stays in view above it. **Show preview** stays pressed.

## A wide tab puts the Preview back at the right

1. Do the case above.
2. Make the tab 600 pixels wide or wider.

Expected: the Preview returns to the right of the editor at the width it had
before. The Preview does not hide or show, and **Show preview** stays pressed.
A narrow Preview, made with `Home` on its edge, returns at a narrower tab
width than a wide one.

## Three columns need room after the Preview

1. Show the Preview and the Fields, both at their initial width of 400 pixels.
2. Make the tab about 1000 pixels wide, then about 1200 pixels wide.

Expected: at about 1000 pixels the Preview is at the right, and the Fields
column goes away: the editor keeps at least 360 pixels of width.
**Show fields** is not pressed now; it opens the Fields picker (see **Insert
a field from the Fields picker**). At about 1200 pixels all three columns fit
with the editor 400 pixels wide, and **Show fields** is pressed again. In a
tab of 560 pixels, the Preview is under the editor and the Fields column goes
away.

## Insert a field from the Fields picker

1. Hide the Preview. Choose "Alpha of the personal library", and place the
   cursor in the note body.
2. Make the tab narrower than 600 pixels, so the Fields column does not fit.
3. Select the **Show fields** view action.
4. Type `doi`, press `ArrowDown` and `ArrowUp`, then press `Enter`.

Expected: step 3 opens the Fields picker under the action, in the style of
Obsidian's suggesters, with the focus in its search field. **Show fields**
reads as expanded. The first row is active, and the area under the list shows
its path (`zt.title`) and its whole value. In step 4 the list keeps the
fields that match `doi`, the arrow keys move the active row and wrap at the
ends, and the area under the list follows the active row. `Enter` writes
`{{ zt.DOI }}` at the cursor, closes the picker and gives the editor the
focus. A screen reader reads each active row with its value, then "Inserted
DOI".

## Close the Fields picker

1. Do steps 1 to 3 of the case above.
2. Press `Escape`.
3. Open the picker again. Select a place outside it, in the editor.
4. Open the picker again. Press `Shift+Tab`.

Expected: step 2 closes the picker and gives **Show fields** the focus. Steps
3 and 4 close the picker too. Each opening starts with an empty search at the
first row. A press on **Show fields** while the picker is open closes it.

## The Fields picker without a cursor

1. Open the Books Profile in a new tab narrower than 600 pixels, and do not
   select the editor.
2. Select **Show fields**, then press `Enter`.

Expected: the picker says "Select a place in the template to insert a
field." `Enter` inserts nothing, and the picker stays open.

## A long value in the Fields picker

1. Choose "Alpha of the personal library". Open the Fields picker in a
   narrow tab.
2. Type `abstract`.

Expected: the row shows the start of the abstract on one line. The area under
the list shows the whole abstract and scrolls when it is long; the arrow keys
still move the active row.

## Narrowing keeps the Fields picker closed

1. Show the Fields in a wide tab. Select **Choose item** in the Fields
   column, then press `Escape`, so the focus is in the column.
2. Make the tab narrower than 600 pixels.
3. Make it wide again.

Expected: after step 2, the column goes away, the picker stays closed, and the
focus moves to **Show fields**. After step 3, the column returns: the Fields
stay shown while the tab is narrow.

## Widening closes the Fields picker

1. Open the Fields picker in a narrow tab.
2. Make the tab wide.

Expected: the picker closes and the focus moves to **Show fields**. If the
Fields were shown, the column returns; otherwise **Show fields** is not
pressed. Narrowing the tab again leaves the picker closed.

## Resize the Preview under the editor

1. Do **A narrow tab puts the Preview under the editor**.
2. Drag the handle above the Preview up.
3. Press `Tab` until the handle has the focus. Press `ArrowUp`, then
   `ArrowDown`, then `Home`, then `End`.
4. Make the window short, so that the tab is less than 400 pixels high.

Expected: the drag makes the Preview taller. With the keyboard, `ArrowUp`
makes it 5% of the tab's height taller and `ArrowDown` 5% shorter; `Home`
makes it 20% of the tab's height and `End` 80%. A screen reader reads the
share as a percentage. After `End`, the editor keeps at least 320 pixels of
height: the toolbar, the tabs, the tab's one-line task and at least five
lines of the note body show above the Preview. Scroll the editor to reach
**Include annotations in the note** and its **Add to template** button; no
part of the editor is cut off. In step 4, the Preview gets shorter first.

## Size the panels from the pane menu

1. Show the Preview and the Fields in a tab about 1600 pixels wide.
2. Open the pane menu. Point to **Resize fields** and select **Make
   narrower**. Point to **Resize preview** and select **Make wider**.
3. Open the pane menu again, point to **Resize fields**, and select **Reset
   width**.
4. Make the tab narrower than 600 pixels. Open the pane menu, point to
   **Resize preview**, and select **Make taller**.
5. Reload Obsidian (**Reload app without saving**).

Expected: in step 1, **Resize fields** and **Resize preview** sit below
**Show preview**, and each submenu offers **Make wider**, **Make narrower** and
**Reset width**; **Reset width** is unavailable while the panel has its
default width of 400 pixels. In step 2, the Fields panel gets 64 pixels
narrower and the Preview 64 pixels wider. In step 3, the Fields panel returns
to 400 pixels. **Make wider** is unavailable when the panel is as wide as the
tab allows, and **Make narrower** when it is 240 pixels wide. In step 4, the
menu has no **Resize fields**, as the Fields panel has no column, and
**Resize preview** offers **Make taller**, **Make shorter** and **Reset
height**. **Make taller** makes the Preview 10% of the tab's height taller.
After step 5, the Preview is under the editor at 50% of the tab's height;
widen the tab, and the Preview returns at the width step 2 gave it.

## A column keeps its place however wide it gets

1. Show the Preview and the Fields in a tab about 1200 pixels wide.
2. Open the pane menu, point to **Resize fields**, and select **Make wider**
   five times.
3. Point to **Resize preview** and look at **Make wider**.
4. Give the Fields edge the focus and press `End`.
5. Make the tab short, less than 600 pixels high, with the Preview under the
   editor. Select **Make taller** under **Resize preview** until it is
   unavailable.

Expected: in step 2, the Fields panel stops at 440 pixels, the width that
keeps the editor 360 pixels wide beside both columns, and **Make wider**
becomes unavailable. The Fields panel stays a column, and **Resize fields**
stays in the menu. In step 3, **Make wider** is unavailable, as a wider
Preview would push the Fields panel out of its column. In step 4, the Fields
panel keeps its width, and a screen reader reads 440 as the largest width. A
drag stops at the same width. In step 5, **Make taller** becomes unavailable
once the Preview stops growing, when the editor keeps 320 pixels of height,
and **Make shorter** makes it shorter at once.

## Reset a panel with a double-click

1. Show the Preview, and widen it with its edge.
2. Double-click the edge.
3. Make the tab narrower than 600 pixels, and drag the handle above the
   Preview up.
4. Double-click the handle.

Expected: step 2 returns the Preview to its default width of 400 pixels, or
less when the tab cannot keep the editor 360 pixels wide beside it. Step 4 returns the Preview to 40% of the
tab's height. A double-click on the Fields edge returns the Fields panel to
400 pixels.

## The Preview height survives a restart

1. Do **A narrow tab puts the Preview under the editor**, then press
   `ArrowUp` twice on the handle above the Preview.
2. Reload Obsidian (**Reload app without saving**).

Expected: the Books Profile opens with the Preview under the editor at 50% of
the tab's height. Widen the tab: the Preview returns to the right at the width
it had before.

## Right-to-left layout

1. Set Obsidian's language to a right-to-left language, or run
   `document.body.dir = "rtl"` in the developer console.
2. Show the Preview and the Fields in a wide tab.
3. Give the Fields edge the focus and press `ArrowLeft`.

Expected: the Fields panel is on the right and the Preview on the left. On
the Fields edge, `ArrowLeft` widens the Fields panel.

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

## Show problem in a narrow and a wide tab

1. Do the case above in a tab narrower than 600 pixels, with the Preview
   shown under the editor.
2. Select **Show fields** so the Fields picker opens, then select
   **Show problem** in the Preview panel.
3. Make the tab wider than 1040 pixels, place the cursor at the start of the
   note body, and select **Show problem** again.

Expected: in step 2 the Fields picker closes, the Problems area opens on the
missing partial, and the editor selects `{% render "missing-partial" %}` in
the note body with the focus on it. The Preview stays under the editor at
its height, and **Show preview** stays pressed. In step 3 the editor selects
the call again, and the Preview stays at the right of the editor at its
width.

## Show problem on an unknown filter

1. Show the Preview, and choose "Alpha of the personal library".
2. In the note body, change `{% render "book-details" with zt as zt %}` to
   `{{ zt.title | no_such_filter }}`, and place the cursor at the start of
   the note body.
3. Select **Show problem** in the Preview panel.

Expected: the Problems area opens on the unknown filter and offers **Go to
error**. The editor selects `{{ zt.title | no_such_filter }}`, and the Note
tab stays chosen.

## Repair commands close the Fields picker

1. In a tab narrower than 600 pixels, show the Preview, and change the note
   body as in **A problem reaches the editor**.
2. Select **Show fields** so the Fields picker opens.
3. In the Problems area, select the button that names where the problem is.

Expected: the Fields picker closes and the editor selects the call. The
Preview and **Show preview** stay as they were.

## Open the annotation box and add the annotation loop

1. In a tab narrower than 600 pixels, show the Preview, and choose
   "Ten Simple Rules for Better Figures".
2. Select **Show fields** so the Fields picker opens. Then select **Add to
   template** in "Include annotations in the note".
3. Open the Fields picker again. Select **Edit format** on the annotation
   example under the new loop.

Expected: in step 2 the Fields picker closes, the loop is added at the end
of the note body, the Note tab stays chosen, and the cursor is after the
loop. In step 3 the picker closes and the Annotation tab opens with the
cursor at the start of the annotation format. The Preview stays under the
editor in both steps, and **Show preview** stays pressed. The web Workbench
does the same steps.

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
