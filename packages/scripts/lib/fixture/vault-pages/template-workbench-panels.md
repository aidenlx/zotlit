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
panel shows as a column too. A popover takes this place in a later release;
until then, the Fields column can make the editor narrower than 360 pixels.
At about 1200 pixels all three columns fit with the editor 400 pixels wide.
In a tab of 560 pixels, the Preview is under the editor and the Fields panel
stays at the left.

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
**Show fields**, and each submenu offers **Make wider**, **Make narrower** and
**Reset width**; **Reset width** is unavailable while the panel has its
default width of 400 pixels. In step 2, the Fields panel gets 64 pixels
narrower and the Preview 64 pixels wider. In step 3, the Fields panel returns
to 400 pixels. **Make wider** is unavailable when the panel is as wide as the
tab allows, and **Make narrower** when it is 240 pixels wide. In step 4, the
menu has no **Resize fields**, as the Fields panel has no column, and
**Resize preview** offers **Make taller**, **Make shorter** and **Reset
height**. **Make taller** makes the Preview 10% of the tab's height taller.
After step 5, the Preview is under the editor at 50% of the tab's height;
widen the tab, and the Preview returns at the width step 2 gave it. A panel
that the menu makes so wide that the editor keeps less than 360 pixels moves
out of its column, as it does after a drag.

## Reset a panel with a double-click

1. Show the Preview, and widen it with its edge.
2. Double-click the edge.
3. Make the tab narrower than 600 pixels, and drag the handle above the
   Preview up.
4. Double-click the handle.

Expected: step 2 returns the Preview to its default width of 400 pixels, or
40% of the tab when that is less. Step 4 returns the Preview to 40% of the
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
