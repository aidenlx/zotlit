---
title: Template workbench panels
---
# Template workbench panels

This page checks the Preview panel of the Template Workbench View. The
Preview sits on the right of the editor in the same tab. It shows the note
that the editor's own render makes for the chosen Item.

Use the Scope Case `all`. Open `templates/zotlit-profile.books.md` and run
**Switch to template workbench view**. Close any other Template Workbench tab
before each case.

## The view opens without panels

1. Open the Books Profile as above.

Expected: the editor fills the tab. The **Show preview** view action is not
pressed. The pane menu shows **Show preview** without a check mark and has no
Preview settings.

## Show and hide the Preview

1. Select the **Show preview** view action.
2. Select it again.

Expected: after step 1, a region named "Preview" opens on the right and the
action is pressed. The pane menu shows **Show preview** checked, followed by
**Preview as new note**, **Preview as updated note**, **Preview updated
section only**, **Automatically refresh preview** and **Show Markdown**.
After step 2, the region closes, and the chosen Item stays chosen.

## One Item in every surface

1. Show the Preview.
2. Select **Choose item** in the view header, and choose "Alpha of the
   personal library".
3. Select **Choose item** in the Preview panel, and choose "Beta of the
   shared reading group".

Expected: after each choice, the editor header, the Properties tab
(`fixture-title`), the Name and folder tab (`books-personalAlpha2024`, then
`books-sharedReadingBeta2022`) and the Preview panel ("Book profile: …") all
name the same Item.

## Resize the Preview

1. Show the Preview.
2. Drag the edge between the editor and the Preview to the left.
3. Press `Tab` until the edge has the focus. Press `ArrowLeft`, then
   `Shift+ArrowLeft`, then `Home`, then `End`.

Expected: the drag widens the Preview. With the keyboard, `ArrowLeft` widens
it by 16 pixels and `Shift+ArrowLeft` by 64 pixels; `Home` makes it as wide as
it can be (960 pixels), and `End` as narrow (240 pixels). The Preview never
takes more than 40% of the tab.

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

Expected: the editor moves to a window of its own with the Preview shown. A
second **Open template workbench** reveals that window and opens no second
one.
