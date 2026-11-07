---
title: Template workbench panels
---
# Template workbench panels

This page checks the Fields sheet and the Preview of the Template Workbench
View, and the standalone Template Data Explorer. The Fields sheet lists the
template fields of the chosen Item. It opens over the editor and the Preview,
at the leading (left) edge of the view, at every width. The Preview sits on
the right and shows the note that the editor's own render makes for that Item.
Both are in the same tab as the editor, under one row that names the chosen
Item. In a tab narrower than 896 pixels (56rem), the Preview moves under the
editor. The Fields sheet does not move the editor or the Preview.

Use the Scope Case `all`. Open `templates/zotlit-profile.books.md` and run
**Switch to template workbench view**. Close any other Template Workbench tab
before each case.

## The view opens with the editor only

1. Open the Books Profile as above.

Expected: the editor fills the tab. The **Show preview** view action is not
pressed, and no Fields sheet is open. The pane menu shows **Show fields** and,
below it, **Show preview**, both without a check mark, and has no Preview
settings.

## Show and hide the Preview

1. Select the **Show preview** view action.
2. Select it again.

Expected: after step 1, a region named "Preview" opens on the right and the
action is pressed. The pane menu shows **Show preview** checked, followed by
**Resize preview**, **Preview as new note**, **Preview as updated note**, **Preview updated
section only**, **Automatically refresh preview** and **Show Markdown**. The
menu has no **Resize fields**.
After step 2, the region closes, and the chosen Item stays chosen.

## Open and close the Fields sheet at every width

1. Make the tab 1200 pixels wide. Select the **Fields** view action. Select it
   again.
2. Do step 1 again with the tab 960, 760, 560 and 320 pixels wide.

Expected: the tooltip of the view action reads "Fields". In the web Workbench,
the header button reads **Fields**. At each width, the first select opens one
region named "Fields" at the left edge of the view. It slides in over the
editor and the Preview, above a dimmed scrim. Its header shows the braces
icon, the title "Fields" and a **Close** button. Under the header are the
"Template fields" explorer and its search. The editor and the Preview keep
their size. While the sheet is open, the pane menu shows **Show fields**
checked. The second select closes the sheet and the scrim, and the chosen Item
stays chosen. The web Workbench's **View** menu shows **Show fields** the same
way.

## Close the Fields sheet and return the focus

1. Select **Fields**. Select the dimmed scrim, to the right of the sheet.
2. Select **Fields**. Press `Escape`.
3. Select **Fields**. Select **Close**.
4. Select **Fields**. Select **Fields** again.

Expected: each step closes the sheet. After steps 1, 2 and 3, the focus is on
the **Fields** view action. The web Workbench does the same steps, with the
same outcome.

## The Fields sheet keeps the focus

1. Show the Preview. Select **Fields**.
2. Press `Tab` until the focus has gone through every control of the sheet and
   comes back to the start. Press `Shift+Tab` from the first control.
3. Select a place on the scrim over the editor, then open the sheet again and
   select a place on the scrim over the Preview.

Expected: in step 1 the focus goes to the field search of the sheet. In step 2
`Tab` goes from the last control of the sheet to its first control, and
`Shift+Tab` goes from the first to the last: the focus never reaches the
editor or the Preview. In step 3 each select closes the sheet. The cursor in
the editor does not move, and no control of the Preview takes the select.

## One Item in every surface

1. Show the Preview.
2. Select **Choose item** in the row above the editor, and choose "Alpha of
   the personal library". Select **Fields**, and look at the sheet. Close it.
3. Select **Choose item** there again, and choose "Beta of the shared reading
   group". Select **Fields**, and look at the sheet.

Expected: one row above the editor and the Preview names the chosen Item; it
holds the view's one **Choose item**. The sheet header and the view header hold
no other **Choose item**, and no other line names the Item. After each choice,
the row, the Properties tab (`fixture-title`), the Name and folder tab
(`books-personalAlpha2024`, then `books-sharedReadingBeta2022`), the Fields
sheet (`title`) and the Preview panel ("Book profile: …") all show the same
Item.

## Help in the view header

1. Select **Help** in the view header.
2. Open the pane menu.

Expected: step 1 opens a menu under the button with **Template guide**,
**Template syntax**, **Template data reference**, then **Ask the community**;
each opens its page in the browser. The header actions read, from the right:
More options, **Help**, **Show preview**, **Fields**, **Source**, Redo,
Undo. In step 2, the pane menu holds no **Help**.

## Collapse every section of the Fields sheet

1. Select **Fields**.
2. Select the button at the end of the field search row.
3. Select it again.

Expected: the button sits in one row with the field search, at its end, and
looks like Obsidian's other icon buttons. Its tooltip reads **Collapse all
sections**; step 2 closes every section, and the tooltip then reads **Expand
all sections**. Step 3 opens them all again.

## The Fields sheet follows the editor

1. Choose "Alpha of the personal library". Open the Annotation tab. Select
   **Fields**.
2. In the sheet, select **Back to note root**. Close the sheet.
3. Open the Name and folder tab, then the Annotation tab again. Select
   **Fields**.
4. In the sheet, select **Back to note root**. Close the sheet, choose "Beta of
   the shared reading group", and select **Fields**.

Expected: after step 1, the sheet shows the Annotation root of the chosen
annotation. After step 2, it shows the Note root, and the editor stays on the
Annotation tab. In step 3, the sheet follows the editor: it opens on the Note
name root after the Name and folder tab, and on the Annotation root after the
Annotation tab. After step 4, the new Item starts the sheet over at the
editor's Annotation root.

## Insert a field from the Fields sheet

1. Choose "Alpha of the personal library". Select **Source**, and place the
   cursor in the note body.
2. Select **Fields**. On the row of `title`, select **Insert field**.
3. Type `x`.
4. Select **Fields** again. Open the row menu of `title`.

Expected: step 2 writes `{{ zt.title }}` at the cursor, closes the sheet and
gives the editor the focus, after the inserted text. In step 3 the `x` follows
the inserted `}}` with no space between them. In step 4, the menu offers
**Copy path**, **Copy value** and the Template Snippets, each of which copies
to the clipboard. The web Workbench does the same steps, with the same
outcome.

## A list field in the Fields sheet

1. Choose "Alpha of the personal library", and select **Fields**.
2. Find the **All creators** row (Reference) and the **Tags** row (Common
   fields) without opening them.
3. Close the sheet. Select **Source**, and place the cursor in the note body.
   Select **Fields**, open the row menu of **All creators**, and select
   **Insert field**.
4. Select **Fields**, open the row menu of **All creators** again, and select
   **Copy loop**. Close the sheet, and paste it on a new line of the note body.
5. Select **Fields**, open the row menu of **Tags**, select **Copy joined**,
   close the sheet, and paste it on a new line. Then select **Copy loop** in
   the same menu, and paste it under a line of text.

Expected: in step 2, **All creators** shows `(3)` and every item in one
line: "Ada Personal, Erin Editor, ZotLit Research Collective". **Tags**
shows `(2)` and "fixture-core, read-later". In both row menus, **Copy joined**
comes before **Copy loop**. Step 3 writes
`{{ zt.creators | join: ", " }}` and closes the sheet, and the Preview shows
the three names in one line. Step 4 pastes `{% for creator in zt.creators %}`
and `- {{ creator }}{% endfor %}` on two lines; the Preview shows each name as
its own list item. Step 5 pastes `{{ zt.tags | join: ", " }}`, then the tag
loop, which the Preview shows as the two list items "fixture-core" and
"read-later". No snippet that a list offers names one item, such as `[0]`.

## Keep the Fields sheet open while inserting

1. Choose "Alpha of the personal library". Select **Source**, and place the
   cursor in the note body.
2. Select **Fields**. Hold `Shift` and select **Insert field** on the row of
   `title`.
3. Press `Tab` until **Insert field** on the row of `DOI` has the focus. Press
   `Shift+Enter`.
4. Press `Escape`.

Expected: steps 2 and 3 write `{{ zt.title }}` and `{{ zt.DOI }}` into the
note body, and the sheet stays open each time. Step 4 closes the sheet and
gives the focus to the **Fields** view action.

## The Fields sheet without a cursor

1. Open the Books Profile in a new tab, and do not select the editor.
2. Select **Fields**. Look at the rows. Open the row menu of `title`.
3. Press `Escape`. Select **Source**, and do not select the editor. Select
   **Fields**, and look at the rows.
4. Close the sheet. Place the cursor in the note body. Select **Fields**.

Expected: in steps 2 and 3 the rows have no **Insert field** button, and the
note's heading and the front matter stay as they were. The row menu still
offers the copy actions. In step 4 each row has **Insert field**, and the
button inserts its field at the cursor. The web Workbench does the same steps,
with the same outcome.

## Insert a field in a narrow tab with the keyboard

1. Make the tab about 500 pixels wide. Hide the Preview. Choose "Alpha of the
   personal library", and place the cursor in the note body.
2. Select **Fields**. Type `doi` in the field search.
3. Press `Tab` until **Insert field** on the row of `DOI` has the focus. Press
   `Enter`.
4. Type `x`.

Expected: step 2 keeps the fields that match `doi`. Step 3 writes
`{{ zt.DOI }}` at the cursor, closes the sheet and gives the editor the focus.
In step 4 the note body reads `{{ zt.DOI }}x`: the cursor is after the
inserted text. The web Workbench does the same steps, with the same outcome.

## Resizing never opens or closes the Fields sheet

1. With the sheet closed, show the Preview in a wide tab. Make the tab 320
   pixels wide, then 1200 pixels wide, then shorter than 400 pixels high, then
   tall again.
2. Select **Fields**. Do the same resizes again.

Expected: in step 1 the sheet stays closed at every size. In step 2 the sheet
stays open at the left edge of the view at every size, and the Preview moves
under the editor and back as in **A narrow tab puts the Preview under the
editor**. The web Workbench does the same when the window changes size.

## The Fields sheet is closed after a reload

1. Select **Fields**.
2. Reload Obsidian (**Reload app without saving**).

Expected: the Books Profile opens with no Fields sheet. The pane menu shows
**Show fields** without a check mark.

## Export from the Fields sheet

1. Choose "Alpha of the personal library", and open the Annotation tab.
2. Open the pane menu.
3. Select **Fields**. In the sheet, select **Back to note root**. Open the pane
   menu again, and select **Save template data as JSON**.
4. Close the sheet, and open the pane menu.

Expected: in step 2 the pane menu offers **Export selected paper data**, as
the paper has no annotations. In step 3 it offers **Save template data as
JSON**, and the saved file holds the Note root the sheet shows, not the
editor's Annotation root. With the sheet closed (step 4), the entry exports
the editor's own root.

## Resize the Preview

1. Show the Preview.
2. Drag the edge between the editor and the Preview to the left.
3. Press `Tab` until the edge has the focus. Press `ArrowLeft`, then
   `Shift+ArrowLeft`, then `Home`, then `End`.

Expected: the drag widens the Preview. With the keyboard, `ArrowLeft` widens
it by 16 pixels and `Shift+ArrowLeft` by 64 pixels; `Home` makes it as narrow
as it can be (240 pixels), and `End` as wide as the tab allows: the width that
keeps the editor 360 pixels wide beside the edge. In a tab 1700 pixels wide,
that is 1336 pixels, past 40% of the tab. A screen reader reads the width the
panel has and the largest width it can take.

## The Preview survives a restart

1. Show the Preview and widen it.
2. Reload Obsidian (**Reload app without saving**).

Expected: the Books Profile opens with the Preview shown, at the same width.

## A narrow tab puts the Preview under the editor

1. Show the Preview at its initial width.
2. Make the tab narrower than 896 pixels (56rem), for example by splitting it
   to the right and dragging the split.

Expected: the Preview moves under the editor and takes 40% of the tab's
height. A horizontal handle sits between the editor and the Preview. The
source stays in view above it. **Show preview** stays pressed.

## A wide tab puts the Preview back at the right

1. Do the case above.
2. Make the tab 896 pixels wide or wider.

Expected: the Preview returns to the right of the editor at the width it had
before. The Preview does not hide or show, and **Show preview** stays pressed.
A narrow Preview, made with `Home` on its edge, returns at the same 896-pixel
tab width as a wide one: the tab's width alone decides.

## The Preview keeps what you were doing in it

1. Show the Preview in a wide tab. Scroll the rendered note down, then press
   `Tab` until a control in the Preview has the focus, such as a property's
   link.
2. Make the tab narrower than 896 pixels, then wide again.

Expected: the Preview moves under the editor and back to the right, and the
same control keeps the focus each time. The rendered note keeps its scroll
position. The web Workbench does the same when the window narrows and widens.

## The Preview's header row stays in view

1. Show the Preview in a wide tab, with the first Item of the personal library
   chosen. Scroll the rendered note to its end.
2. Make the tab narrower than 896 pixels, then scroll the Preview under the
   editor to its end.
3. Select the **Annotation** tab and scroll the Preview.
4. Select the **Note** tab and type `{{ zt.title | nofilter }}` in the source,
   so that the render fails.
5. In the web Workbench, choose a sample paper and scroll the rendered note.

Expected: after step 1, the row "Note preview", "New note" and "File name:
books-personalAlpha2024" stays at the top of the Preview while the note
scrolls under it, and a rule marks its bottom edge. The editor's tab row
(**Note**, **Properties**, …) stands above the template source only, so the
Preview starts right under the item row and takes the full height beside the
editor. After step 2, the same row stays at the top of the Preview under the
editor, and the tab row stays above the source. After step 3, the row reads
"Annotation example" with no file name and stays at the top. After step 4,
the row shows no file name, and the problem notice stands below the row.
After step 5, the file name, such as `ioannidisWhyMost2005`, stays at the top
of the result box while the note scrolls, and the "Note preview" heading and
its controls stay above the box.

## A tab moved to its own window

1. Show the Preview in a wide tab.
2. Drag the tab out of the window, so it opens in a window of its own.
3. Make the new window about 500 pixels wide. Select **Fields**, then close
   the sheet.
4. Make the window wide again.

Expected: at about 500 pixels the Preview moves under the editor, and
**Fields** opens the same sheet at the left edge of the window as in a tab of
the main window. When the window is wide again, the Preview returns to the
right, and the sheet stays as the reader left it.

## Show fields in the pane menu

1. In a tab narrower than 600 pixels, open the pane menu and select **Show
   fields**.
2. Open the pane menu again.
3. Select **Show fields**.
4. In a tab wider than 1040 pixels, do steps 1 to 3 again.

Expected: in step 1 the entry has no check mark. It opens the Fields sheet
with the focus in its field search, as the **Fields** view action does. In
step 2 the entry shows a check mark. Step 3 closes the sheet. Step 4 gives the
same outcome in a wide tab. The web Workbench's **View** menu does the same.

## Resize the Preview under the editor

1. Do **A narrow tab puts the Preview under the editor**.
2. Drag the handle above the Preview up.
3. Press `Tab` until the handle has the focus. Press `ArrowUp`, then
   `ArrowDown`, then `Home`, then `End`.
4. Make the window short, so that the tab is less than 400 pixels high.

Expected: the drag makes the Preview taller. With the keyboard, `ArrowUp`
makes it 5% of the tab's height taller and `ArrowDown` 5% shorter; `Home`
makes it 20% of the tab's height and `End` 80%. A screen reader reads the
share as a percentage, the share the tab draws. In a short tab, where the
Preview draws less than its saved share to keep the editor 320 pixels high,
the handle reads the share drawn, and `ArrowDown` makes the Preview shorter
at once: each step starts from what you see, as the menu's do. After `End`, the editor keeps at least 320 pixels of
height: the toolbar, the tabs, the tab's one-line task and at least five
lines of the note body show above the Preview. Scroll the editor to reach
**Include annotations in the note** and its **Add to template** button; no
part of the editor is cut off. In step 4, the Preview gets shorter first.

## Size the Preview from the pane menu

1. Show the Preview in a tab about 1600 pixels wide.
2. Open the pane menu. Point to **Resize preview** and select **Make wider**.
3. Open the pane menu again, point to **Resize preview**, and select **Reset
   width**.
4. Make the tab narrower than 600 pixels. Open the pane menu, point to
   **Resize preview**, and select **Make taller**.
5. Reload Obsidian (**Reload app without saving**).

Expected: in step 1, **Resize preview** sits below **Show preview**, and its
submenu offers **Make wider**, **Make narrower** and **Reset width**. The menu
has no **Resize fields**. After each entry, a screen reader reads the panel and
its new size, such as "Preview: 464 pixels" or "Preview: 50%"; a screen reader
reads the edge's width as "400 pixels". **Reset width** is unavailable while
the Preview has its default width of 400 pixels. In step 2, the Preview gets
64 pixels wider. In step 3, the Preview returns to 400 pixels. **Make wider**
is unavailable when the Preview is as wide as the tab allows, and **Make
narrower** when it is 240 pixels wide. In step 4, **Resize preview** offers
**Make taller**, **Make shorter** and **Reset height**. **Make taller** makes
the Preview 10% of the tab's height taller. After step 5, the Preview is under
the editor at 50% of the tab's height; widen the tab, and the Preview returns
at the width step 2 gave it.

## The Preview keeps room for the editor

1. Show the Preview in a tab about 1200 pixels wide.
2. Open the pane menu, point to **Resize preview**, and select **Make wider**
   until it is unavailable.
3. Give the Preview edge the focus and press `End`.
4. Make the tab short, less than 600 pixels high, with the Preview under the
   editor. Select **Make taller** under **Resize preview** until it is
   unavailable.

Expected: in step 2, the Preview stops at 836 pixels, the width that keeps the
editor 360 pixels wide beside the Preview and its 4-pixel edge, and **Make
wider** becomes unavailable. In step 3, the Preview keeps its width, and a
screen reader reads 836 as the largest width. A drag stops at the same width.
In step 4, **Make taller** becomes unavailable once the Preview stops growing,
when the editor keeps 320 pixels of height, and **Make shorter** makes it
shorter at once.

## Reset the Preview with a double-click

1. Show the Preview, and widen it with its edge.
2. Double-click the edge.
3. Make the tab narrower than 896 pixels, and drag the handle above the
   Preview up.
4. Double-click the handle.

Expected: step 2 returns the Preview to its default width of 400 pixels, or
less when the tab cannot keep the editor 360 pixels wide beside it. Step 4
returns the Preview to 40% of the tab's height.

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
2. Show the Preview in a wide tab. Select **Fields**.
3. Press `Escape`.

Expected: the Preview is on the left of the editor. In step 2 the Fields sheet
slides in from the right edge of the view, its leading edge, over the editor
and the Preview. Step 3 closes it and gives the focus to **Fields**.

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
2. Select **Show problem** in the Preview panel.
3. Make the tab wider than 1040 pixels, place the cursor at the start of the
   note body, and select **Show problem** again.

Expected: in step 2 the Problems area opens on the missing partial, and the
editor selects `{% render "missing-partial" %}` in the note body with the
focus on it. The selected call is in view above the Problems area, even when
the call is on line 4 and the tab is short: the editor area scrolls to it. A
screen reader reads the call and then why it fails: "The partial
'missing-partial' isn't in your template folder." Under the explanation, a
rule separates it from **Go to the call** and the other buttons; a long
explanation scrolls under that rule, and no line of it stands behind the
buttons. The Preview stays under the editor at its height, and **Show
preview** stays pressed. In step 3 the editor selects the call again, and the
Preview stays at the right of the editor at its width.

## Show problem on an unknown filter

1. Show the Preview, and choose "Alpha of the personal library".
2. In the note body, change `{% render "book-details" with zt as zt %}` to
   `{{ zt.title | no_such_filter }}`, and place the cursor at the start of
   the note body.
3. Select **Show problem** in the Preview panel.

Expected: the Problems area opens on the unknown filter and offers **Go to
error**. The editor selects `{{ zt.title | no_such_filter }}`, and the Note
tab stays chosen. A screen reader reads why the call fails after the
selected call.

## Open the annotation box and add the annotation loop

1. In a tab narrower than 600 pixels, show the Preview, and choose
   "Ten Simple Rules for Better Figures".
2. Select **Add to template** in "Include annotations in the note".
3. Select **Edit format** on the annotation example under the new loop.

Expected: in step 2 the loop is added at the end of the note body, the Note
tab stays chosen, and the cursor is after the loop. In step 3 the Annotation
tab opens with the cursor at the start of the annotation format. The Preview
stays under the editor in both steps, and **Show preview** stays pressed. No
Fields sheet is open after either step. The web Workbench does the same steps.

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
2. Select **Fields**.

Expected: after step 1, the editor moves to a window of its own with the
Preview shown, and no Template Data Explorer tab opens beside it. The Fields
sheet stays closed. A second **Open template workbench** reveals that window
and opens no second one. Step 2 opens the Fields sheet over the editor and the
Preview.

## The standalone Template Data Explorer

1. Open the Books Profile, and choose "Alpha of the personal library".
2. Run **Open template data explorer** from the command palette, and choose
   "Beta of the shared reading group" in it.
3. In the editor, choose "Within-library duplicate, first item".
4. Switch between the editor tab and a normal note.
5. In the editor tab, select **Fields**.

Expected: step 2 opens the explorer in the right sidebar on its own Item; the
editor keeps "Alpha of the personal library". Step 3 leaves the explorer on
"Beta of the shared reading group". In step 4 the explorer stays where it is.
In step 5 the Fields sheet shows the editor's Item, "Within-library duplicate,
first item". The explorer's rows offer copy and Template Snippets, and no
**Insert field**. **Explore template data** on a Literature Note's file menu,
and the Zotero `explore` action, open the same standalone explorer.

## List snippets in the standalone explorer

1. Run **Open template data explorer**, and choose "Alpha of the personal
   library" in it.
2. Open the row menu of **All creators**.
3. Open the **All creators** row, and open the row menu of its first item.

Expected: before step 2, the closed **All creators** row shows `(3)` and
"Ada Personal, Erin Editor, ZotLit Research Collective". In step 2, the menu offers **Copy joined** before **Copy loop**.
**Copy joined** copies `{{ zt.creators | join: ", " }}`; **Copy loop** copies
the loop with each creator on its own `- ` line. With JavaScript templates
on, the Eta submenu offers `<%= zt.creators.join(", ") %>` and
`<% for (const creator of zt.creators) { %>` with `- <%= creator %><% } %>`.
In step 3, the explorer still lists each item by its number, so **Explore
annotation** keeps working for an annotation row; the item's own snippets
name its path, as before.

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
