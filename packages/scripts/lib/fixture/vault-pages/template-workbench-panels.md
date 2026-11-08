---
title: Template workbench panels
---
# Template workbench panels

This page checks the Fields popover and the Preview of the Template Workbench
View, and the standalone Template Data Explorer. The Fields popover lists the
template fields of the chosen Item. It floats at the right edge of the view,
over the editor and the Preview, at every width. It is not modal: the editor
and the Preview stay usable while it is open. The Preview sits on the right
and shows the note that the editor's own render makes for that Item. Both are
in the same tab as the editor, under one row that names the chosen Item. In a
tab narrower than 896 pixels (56rem), the Preview moves under the editor. The
Fields popover does not move the editor or the Preview. The reader can pin
the Fields Panel: in a tab with room, it then docks as a column at the left
edge of the view, before the editor.

Use the Scope Case `all`. Open `templates/zotlit-profile.books.md` and run
**Switch to template workbench view**. Close any other Template Workbench tab
before each case.

## The view opens with the editor only

1. Open the Books Profile as above.

Expected: the editor fills the tab. The **Show preview** view action is not
pressed, and no Fields popover is open. The pane menu shows **Show fields** and,
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

## Open and close the Fields popover at every width

1. Make the tab 1200 pixels wide. Select the **Fields** view action. Select it
   again.
2. Do step 1 again with the tab 960, 760, 560 and 320 pixels wide.

Expected: the tooltip of the view action reads "Fields". In the web Workbench,
the header button reads **Fields**. At each width, the first select opens one
region named "Fields" at the right edge of the view. It floats over the
editor and the Preview, as tall as the view, with a small gap between it and
the view's top, right and bottom edges. Nothing under it is dimmed. Its
header shows the braces icon, the title "Fields" and a **Close fields** button.
Under the header are the "Template fields" explorer and its search. The
editor and the Preview keep their size. While the popover is open, the pane
menu shows **Show fields** checked. The second select closes the popover, and
the chosen Item stays chosen. The web Workbench's **View** menu shows **Show
fields** the same way.

## Close the Fields popover and return the focus

1. Select **Fields**. Press `Escape`.
2. Select **Fields**. Select **Close fields**.
3. Select **Fields**. Select **Fields** again.

Expected: each step closes the popover. After steps 1 and 2, the focus is on
the **Fields** view action. The web Workbench does the same steps, with the
same outcome.

## Click outside the Fields popover

1. Show the Preview in a wide tab. Select **Fields**.
2. Select an empty place in the Preview, outside the popover.
3. Select **Fields**. Select the row above the editor that names the Item,
   away from **Choose item**.

Expected: in step 1 the focus goes to the field search of the popover. Steps 2
and 3 each close the popover, and the focus is then on the **Fields** view
action. The web Workbench does step 2 with the same outcome.

## The editor and the Preview stay usable

1. Show the Preview in a wide tab. Select **Source**, and place the cursor in
   the note body.
2. Select **Fields**. Press `Tab` from the last control of the popover.
3. Select **Fields**. Select a place in the note body.

Expected: in step 2 the focus leaves the popover and goes on through the view;
it is not held inside the popover. Nothing behind the popover is dimmed, and
the editor and the Preview stay at their size and place. In step 3 the
popover closes and the editor takes the select.

## Show problem while the Fields popover is open

1. Show the Preview, and choose "Alpha of the personal library".
2. In the note body, change `{% render "book-details" with zt as zt %}` to
   `{% render "missing-partial" %}`.
3. Select **Fields**. Select **Show problem** in the Preview panel.

Expected: in step 3 **Show problem** can be selected while the popover is
open. It closes the popover, the Problems area opens on the missing partial,
and the editor selects `{% render "missing-partial" %}` with the focus on it.
The focus does not go to the **Fields** view action.

## One Item in every surface

1. Show the Preview.
2. Select **Choose item** in the row above the editor, and choose "Alpha of
   the personal library". Select **Fields**, and look at the popover. Close it.
3. Select **Choose item** there again, and choose "Beta of the shared reading
   group". Select **Fields**, and look at the popover.

Expected: one row above the editor and the Preview names the chosen Item; it
holds the view's one **Choose item**. The popover header and the view header hold
no other **Choose item**, and no other line names the Item. After each choice,
the row, the Properties tab (`fixture-title`), the Name and folder tab
(`books-personalAlpha2024`, then `books-sharedReadingBeta2022`), the Fields
popover (`title`) and the Preview panel ("Book profile: …") all show the same
Item. **Choose item** stands right after the Item's name, not at the far edge
of the row, in a wide view too. Make the view narrow: the name ends in "…",
shows in full on hover, and **Choose item** stays beside it on the same line.

## Help in the view header

1. Select **Help** in the view header.
2. Open the pane menu.

Expected: step 1 opens a menu under the button with **Template guide**,
**Template syntax**, **Template data reference**, then **Ask the community**;
each opens its page in the browser. The header actions read, from the right:
More options, **Help**, **Show preview**, **Fields**, **Source**, Redo,
Undo. In step 2, the pane menu holds no **Help**.

## Collapse every section of the Fields popover

1. Select **Fields**.
2. In the panel's header, select the button before the pin.
3. Select it again.
4. Pin the panel in a wide tab, and do steps 2 and 3 in the docked panel.

Expected: the button sits in the panel's header, before the pin, and looks
like Obsidian's other icon buttons; the field search row holds the search
alone. Its tooltip reads **Collapse all sections**; step 2 closes every
section, and the tooltip then reads **Expand all sections**. Step 3 opens
them all again. Step 4 gives the same outcome in the docked panel.

## Section headers in the Fields popover

1. Choose "Alpha of the personal library", and select **Fields**.
2. Look at the header of each section.
3. Scroll the field list slowly down to its end.
4. Select the **Reference** header. Select it again.
5. Open **All creators**, and look at the **Reference** header's count.
6. Pin the panel in a wide tab, and do steps 2 to 5 in the docked panel.

Expected: in step 2, each header shows the section's icon, its name, the
count of its own fields, such as "Reference 12", and a chevron at its right
end. In step 3, the header of the section you read stays at the top of the
list, on the panel's own background, until the next section's header pushes
it away; no row shows through it. Step 4 closes the Reference section, with
its chevron pointing right, and opens it again. In step 5 the count stays
"Reference 12" with the creators open. Step 6 gives the same outcome in the
docked panel.

## A search opens every section with a match

1. Select **Fields**, and collapse every section with the button in the
   panel's header.
2. Type `personal` in the field search.
3. Clear the search.

Expected: in step 2, every section with a matching field shows open with its
matching rows: Common fields, Reference, Identifiers, Content and files, and
Organization. The section headers keep their full color; only their chevrons
and the collapse button step back, and a select on a header changes nothing.
In step 3, every section is closed again, as before the search.

## Search the fields by their template path

1. Choose "Alpha of the personal library", and select **Fields**.
2. Type each of these in the field search, one at a time: `zt.title`,
   `zt.authors`, `authors.family`, `zt.citationKey`.
3. Type `no such field`.

Expected: in step 2 each search keeps the field it names: **Title**,
**Authors**, the `family` row under **Authors**, and **Citation key**. A
search that reaches into a list, such as `authors.family`, opens that list on
its matching row only. In step 3 the list reads "No matching fields. Clear
the search to see all fields.", and a screen reader reads that sentence. The
web Workbench does the same steps, with the same outcome.

## The rows of the Fields Panel

1. Choose "Alpha of the personal library", and select **Fields**.
2. Compare the left edge of the field names with the section icons.
3. Open **All creators** (Reference).
4. Resize the docked panel to its narrowest, 240 pixels, after you pin it in
   a wide tab.

Expected: in step 2, each field name starts at the left edge of its section's
icon, and each row is one line: a long value, such as the title, ends with
"…". In step 3, the chevron follows the name **All creators**, and its
property rows, such as `family` and `given`, stand a little in, behind one
thin vertical guide line that runs unbroken down their rows. No row stands
for one creator. A property that is a field with a name of its own shows that
name: open **Annotations** (Content and files), and its rows read "Your
comment" and "Page", not `comment` and `pageLabel`; `family` and `given` have
no such name and keep their keys. In step 4, every row stays one line, and a
long name, such as "Short author list", also ends with "…".

## The Fields popover follows the editor

1. Choose "Alpha of the personal library". Open the Annotation tab. Select
   **Fields**.
2. In the popover, select **Back to note root**. Close the popover.
3. Open the Name and folder tab, then the Annotation tab again. Select
   **Fields**.
4. In the popover, select **Back to note root**. Close the popover, choose "Beta of
   the shared reading group", and select **Fields**.

Expected: after step 1, the popover shows the Annotation root of the chosen
annotation. After step 2, it shows the Note root, and the editor stays on the
Annotation tab. In step 3, the popover follows the editor: it opens on the Note
name root after the Name and folder tab, and on the Annotation root after the
Annotation tab. After step 4, the new Item starts the popover over at the
editor's Annotation root.

## Insert a field from the Fields popover

1. Choose "Alpha of the personal library". Select **Source**, and place the
   cursor in the note body.
2. Select **Fields**. On the row of `title`, select **Insert field**.
3. Type `x`.
4. Select **Fields** again. Open the row menu of `title`.

Expected: step 2 writes `{{ zt.title }}` at the cursor, closes the popover and
gives the editor the focus, after the inserted text. In step 3 the `x` follows
the inserted `}}` with no space between them. In step 4, the menu offers
**Copy path**, **Copy value** and the Template Snippets, each of which copies
to the clipboard. The web Workbench does the same steps, with the same
outcome.

## A list field in the Fields popover

1. Choose "Alpha of the personal library", and select **Fields**.
2. Find the **All creators** row (Reference) and the **Tags** row (Common
   fields) without opening them.
3. Select the chevron after the **All creators** label.
4. Close the popover. Select **Source**, and place the cursor in the note body.
   Select **Fields**, and select **Insert field** on the **All creators** row.

Expected: in step 2, **All creators** shows `(3)` and every item in one
line: "Ada Personal, Erin Editor, ZotLit Research Collective". **Tags**
shows `(2)` and "fixture-core, read-later". A chevron follows the label of
**All creators**, a list of creators. **Tags** has a chevron too: each tag
carries its `name` and its `type`. In step 3 the row opens to one sub-row
for each property of its items, such as `family` and `given`, and each
sub-row shows that property for all three creators in one line. The
**All creators** row keeps its count and its items. No row stands for one
creator, and no row's path names one item, such as `[0]`. Step 4 writes
`{{ zt.creators | join: ", " }}` and closes the popover, and the Preview
shows the three names in one line.

## A list field's details and its two forms

1. Choose "Alpha of the personal library", select **Source**, place the
   cursor on a new line of the note body, and select **Fields**.
2. Select the **All creators** row.
3. Under **In your note**, select **Each item**.
4. Select **Copy**, and paste on a new line of the note body.
5. Select **Fields**, select the **All creators** row, select **Each item**,
   and select **Insert**.
6. Select **Fields**, open **All creators** with its chevron, and select the
   `family` sub-row.
7. Select **Insert** with **In one line**, then select the `family` sub-row
   again, choose **Each item**, and select **Insert**.

Expected: step 2 opens the details. They list the three creators one per
line, numbered 1 to 3, and offer **In one line** (chosen) and **Each item**.
The snippet is `{{ zt.creators | join: ", " }}` and its result is the three
names in one line. Step 3 changes the snippet to
`{% for creator in zt.creators %}` and `- {{ creator }}{% endfor %}` on two
lines, and the result to three lines that each start with `- `. Step 4
pastes that loop, and **Copy** closes the details. Step 5 inserts the same
loop, closes the popover, and the Preview shows each creator as its own list
item. Step 6 lists each creator's family name, numbered. Step 7 inserts
`{{ zt.creators | map: "family" | join: ", " }}`, then the loop with
`- {{ creator.family }}`; the Preview shows the family names in one line,
then one list item each. A field that is not a list, such as `title`, shows
no form choice. The template path of `family` reads
"zt.creators → each item's family".

## A list whose items do not read as text

1. Open `templates/zotlit-citation.md` in the Template Workbench View with
   its default example set, and select **Fields**.
2. Select the **Cited items** row.
3. Open **Cited items** with its chevron.

Expected: in step 2, the details offer **Each item** alone, already chosen,
because a cited item is a record with no text of its own; **In one line**
is not offered. The row and the snippet show the first property, in the
rows' order, that has a value and reads as text: the snippet is
`{% for item in zt.items %}` and `- {{ item.citationKey }}{% endfor %}`, and
the result is "- ioannidisWhyMost2005". The empty `abstract` is passed
over. **Insert field** on the row inserts the same loop. **Citation items**
offers **Each item** alone too; its loop passes over the cited `item`, a
record, and the empty `label`, and shows `citation.labelShort`, "p.".
In step 3, the row opens to one row for each property of a cited item, such
as `title` with "Why Most Published Research Findings Are False"; a property
the item has no value for, such as `DOI`, reads "Empty for this item".

## Explore an annotation from the Fields popover

1. Choose "Ten Simple Rules for Better Figures", and select **Fields**.
2. Open the row menu of **Annotations**, and select **Explore as annotation
   template data**.
3. Choose "Alpha of the personal library", select **Fields**, and open the
   row menu of **Annotations**.

Expected: the **Annotations** row shows its count and has a chevron, and no
row stands for one annotation. Step 2 moves the popover to the annotation
root. It shows the view's chosen annotation, or the Item's first annotation
when none is chosen. **Choose annotation** in the view's item row picks
another, and the back arrow returns to the note root. In step 3, the Item
has no annotations: **Annotations** shows `(0)` with no chevron, and its menu
offers no **Explore as annotation template data**.

## Keep the Fields popover open while inserting

1. Choose "Alpha of the personal library". Select **Source**, and place the
   cursor in the note body.
2. Select **Fields**. Hold `Shift` and select **Insert field** on the row of
   `title`.
3. Press `Tab` until **Insert field** on the row of `DOI` has the focus. Press
   `Shift+Enter`.
4. Press `Escape`.

Expected: steps 2 and 3 write `{{ zt.title }}` and `{{ zt.DOI }}` into the
note body, and the popover stays open each time. After each, the focus stays
on that row's **Insert field** button. Step 4 closes the popover and gives the
focus to the **Fields** view action.

## The Fields popover without a cursor

1. Open the Books Profile in a new tab, and do not select the editor.
2. Select **Fields**. Look at the rows. Open the row menu of `title`.
3. Press `Escape`. Select **Source**, and do not select the editor. Select
   **Fields**, and look at the rows.
4. Close the popover. Place the cursor in the note body. Select **Fields**.

Expected: in steps 2 and 3 the rows have no **Insert field** button, and the
note's heading and the front matter stay as they were. The row menu still
offers the copy actions. The panel's footer reads "Select a row or press
Enter: details · Select a place in the template to insert a field." and names
no insert key. Select the row of `title`: its details show **Insert**
disabled, with "Select a place in the template to insert a field." under it.
Press `Down Arrow` and `Ctrl+Enter` (`Command+Enter` on macOS) in the search:
nothing goes into the note, and a notice and a screen reader say the same
sentence. In step 4 each row has **Insert field**, the footer names
`Ctrl+Enter: insert` again, and the button inserts its field at the cursor.
The web Workbench does the same steps, with the same outcome.

## Insert a field in a narrow tab with the keyboard

1. Make the tab about 500 pixels wide. Hide the Preview. Choose "Alpha of the
   personal library", and place the cursor in the note body.
2. Select **Fields**. Type `doi` in the field search.
3. Press `Tab` until **Insert field** on the row of `DOI` has the focus. Press
   `Enter`.
4. Type `x`.

Expected: step 2 keeps the fields that match `doi`. Step 3 writes
`{{ zt.DOI }}` at the cursor, closes the popover and gives the editor the focus.
In step 4 the note body reads `{{ zt.DOI }}x`: the cursor is after the
inserted text. The web Workbench does the same steps, with the same outcome.

## Show a field's details in a wide tab

1. Make the tab at least 600 pixels wide. Choose "Alpha of the personal
   library", and select **Fields**.
2. Move the pointer over the rows of `title`, `DOI` and **All creators**.
3. Select the row of `title`, away from its buttons.
4. Select the row of `title` again.

Expected: in step 2 no details open and no row moves; the row under the
pointer shows its **Insert field** button (a text cursor icon) and its row
menu button in the room they always hold. Each row holds the label and the
value on one line, and a long value ends with "…". Step 3 opens the details
in a popover to the left of the Fields popover, level with the row: the
section, the name "Title", the full title, **Template path** with
`zt.title`, and **In your note** with `{{ zt.title }}` and the title it
writes, then **Insert** and **Copy**. The focus stays in the field search.
Step 4 closes the details. The web Workbench does the same steps, with the
same outcome.

## Show a field's details in a narrow tab

1. Make the tab about 500 pixels wide. Choose "Alpha of the personal
   library", and select **Fields**.
2. Select the row of `title`, then the row of **All creators**.
3. Scroll the field list.
4. Make the tab about 400 pixels high, then zoom the app to 200%
   (`Ctrl+=`), and select the row of `title` again.

Expected: in step 2 the details open in a bar of fixed height at the foot of
the Fields popover, above the line "Select a row or press Enter: details ·
Ctrl+Enter: insert" ("Command+Enter" on macOS). The bar shows the details of the last
row you selected, and the rows above it do not move. In step 3 the bar stays
where it is. In step 4 the bar takes no more than half of the panel, so the
field list keeps at least one whole row, and the bar scrolls to show
**In your note** and its snippet. The web Workbench does the same steps, with
the same outcome.

## A field's text follows the place it goes to

1. Open a Profile whose `language` is `eta` (JavaScript templates on), choose
   "Alpha of the personal library", and place the cursor in the note body.
2. Select **Fields**, and select the row of `title`. Select **Copy**, then
   select the row again and select **Insert**.
3. Open the Properties tab, and place the cursor in the value of an `expr`
   property. Select **Fields**, select the row of `date`, and do as in step 2.

Expected: in step 2 **In your note** shows `<%= zt.title %>`, **Copy** copies
`<%= zt.title %>`, and **Insert** writes `<%= zt.title %>`; `Ctrl+Enter` on
the selected row writes the same. In step 3 the details show `zt.date` and its
value, with no form choice, and **Copy**, **Insert** and `Ctrl+Enter` all give
`zt.date`. A Liquid Profile shows and writes `{{ zt.title }}` in step 2.

## Insert and copy from a field's details

1. Choose "Alpha of the personal library". Select **Source**, and place the
   cursor in the note body.
2. Select **Fields**, select the row of `title`, and select **Copy** in its
   details.
3. Select the row of `DOI`, and select **Insert** in its details.

Expected: step 2 copies `{{ zt.title }}`, closes the details, keeps the Fields
popover open with the focus in the field search, and shows the notice
"Copied Title.". Step 3 writes `{{ zt.DOI }}` at the cursor, closes the
details and the popover, gives the editor the focus after the inserted text,
and shows the notice "Inserted DOI.". A screen reader reads both messages,
also after the popover closed, from the panels' live region.

## Choose a field with the keyboard

1. Choose "Alpha of the personal library", and place the cursor in the note
   body. Select **Fields**.
2. Type `doi`. Press `Down Arrow`, then `Up Arrow` and `Down Arrow`.
3. Press `Enter`, then `Enter` again.
4. Press `Ctrl+Enter` (`Command+Enter` on macOS).

Expected: in step 2 the selected row shows its **Insert field** button and a
focus ring that a row under the pointer never shows, so the two look
different; a screen reader reads it as the search's active option by its
label and value, such as "DOI, 10.…", without its path or its buttons. Step 3
opens the details of the selected row with the focus on **Insert** (for a
list, on its chosen form); `Tab` reaches **Copy**, and `Escape` closes them
and puts the focus back in the search, where `Enter` opens them again. Step 4
writes the selected field at the cursor, closes the popover and gives the
editor the focus. Clear the search and press `Down Arrow` forty times, then
`Up Arrow` forty times: the selected row is always in view, never under a
section header. The web Workbench does the same steps, with the same outcome.

## Close a field's details

1. Make the tab at least 600 pixels wide. Choose "Alpha of the personal
   library", and select **Fields**. Type `ti` in the field search, and select
   the row of `title`.
2. Select inside the details, away from their buttons.
3. Select the field search.
4. Select the row of `title` again. Press `Escape` three times, and look
   after each press.
5. Repeat steps 1 to 4 in a tab about 500 pixels wide.

Expected: step 2 keeps the details open. Step 3 closes them and keeps the
Fields popover open. In step 4, the first `Escape` closes the details, the
second clears the search and keeps the popover open, and the third closes the
popover with the focus on **Fields**. Step 5 gives the same outcome with the
details in the bar.

## A field this item has no value for

1. Choose "Alpha of the personal library", and select **Fields**.
2. Select a row that shows no value.

Expected: the details show "Empty for this item" in place of the value and
under **In your note**. **Insert** and **Copy** still work.

## Resizing never opens or closes the Fields popover

1. With the popover closed, show the Preview in a wide tab. Make the tab 320
   pixels wide, then 1200 pixels wide, then shorter than 400 pixels high, then
   tall again.
2. Select **Fields**. Do the same resizes again.

Expected: in step 1 the popover stays closed at every size. In step 2 the
popover stays open at the right edge of the view at every size, and follows
the view as it resizes: it keeps the small gap to the view's top, right and
bottom edges and fills the height. The Preview moves under the editor and
back as in **A narrow tab puts the Preview under the editor**. The web
Workbench does the same when the window changes size.

## The Fields popover is closed after a reload

1. Select **Fields**.
2. Reload Obsidian (**Reload app without saving**).

Expected: the Books Profile opens with no Fields popover. The pane menu shows
**Show fields** without a check mark.

## Pin the Fields Panel in a wide tab

1. Show the Preview in a tab 1200 pixels wide. Select **Fields**.
2. In the popover header, select the pin button.

Expected: in step 1 the pin button's tooltip reads "Pin to side" and the
button is not pressed. After step 2 the popover closes, and the Fields Panel
stands as a column at the left edge of the view, before the editor, 320
pixels wide. The editor gets narrower and the Preview stays at the right. The
focus is in the panel's field search. The pin button looks pressed, with the
accent color on its icon and a ground behind it, also with the pointer away
from it; it shows the pin-off icon, and its tooltip and its name for a screen
reader read "Unpin", with no "pressed" state beside it. The panel has no **Close fields**
button and nothing in the view is dimmed. **Fields** is pressed, and the pane
menu shows **Show fields** checked. The web Workbench does the same in a
window 1400 pixels wide.

## Insert and type beside the docked panel

1. With the panel docked, put the cursor at the end of the note body.
2. Search the panel for "doi", and select **Insert field** on the DOI row.
3. Type a space.

Expected: `{{ zt.DOI }}` goes in at the cursor, the panel stays docked, and
the focus is in the editor after the field. The space goes in after the
field. Shift-select on **Insert field** inserts the field and keeps the focus
on the row's **Insert field**.

## Resize the docked panel

1. With the panel docked, drag the edge between the panel and the editor to
   the right.
2. Press `Tab` until the edge has the focus. Press `ArrowRight`, then
   `ArrowLeft`, then `Home`, then `End`.
3. Open the pane menu.

Expected: the drag widens the panel. With the keyboard, `ArrowRight` widens it
by 16 pixels and `ArrowLeft` narrows it by 16 pixels; `Home` makes it 240
pixels wide, and `End` 480 pixels wide, or less where the editor would keep
less than 360 pixels. In step 3 the pane menu shows **Resize fields** with
**Make wider**, **Make narrower** and **Reset width** (320 pixels), beside
**Resize preview**. The web Workbench's **View** menu shows the same group.

## Hide and show the docked panel with Fields

1. With the panel docked, select **Fields**.
2. Select **Fields** again.

Expected: step 1 hides the panel, the editor takes its room, and **Fields** is
not pressed. The pin stays: step 2 shows the panel again at the same width,
with the focus in its field search. No popover opens in either step.

## Unpin the docked panel

1. With the panel docked, select the pin button.

Expected: the column closes, and the Fields popover opens at the right edge of
the view with the focus in its field search. The pin button is not pressed.
**Fields** opens and closes the popover from now on.

## The pin is disabled in a narrow tab

1. Make the tab 560 pixels wide, with no pin. Select **Fields**.
2. Select the pin button.

Expected: the popover opens at the right edge. The pin button is dimmed, and
its tooltip reads "Widen the view to pin". Step 2 changes nothing. The popover
shows no note under its header.

## A pinned panel in a narrow tab

1. Pin the panel in a wide tab, then make the tab 560 pixels wide.
2. Select **Fields**.
3. Make the tab 1200 pixels wide.
4. Make the tab 560 pixels wide again.

Expected: in step 1 the docked panel goes and no popover opens over the
editor. In step 2 **Fields** opens the popover. The pin button is dimmed with
the tooltip "Widen the view to pin", and the note "Pinned · opens over the
editor in narrow views" shows under the header. In step 3 the popover closes
and the panel docks again at the left edge, at the width it had, with the
focus in its search. In step 4 the docked panel goes, and no popover opens.
With the Preview beside the editor, a tab needs about 1010 pixels to dock the
panel: the editor keeps 360 pixels beside a panel of 240 pixels and the
Preview column.

## Field details in the docked panel

1. Pin the Fields Panel in a tab 1200 pixels wide, as in **Pin the Fields
   Panel in a wide tab**. Choose "Alpha of the personal library", and place
   the cursor at the end of the note body.
2. In the docked panel's field search, type `doi`. Press `Down Arrow`, then
   `Enter`.
3. Press `Ctrl+Enter` (`Command+Enter` on macOS).
4. Select the field search, and type `ti`. Select the row of `title`. Press
   `Escape` three times, and look after each press.

Expected: step 2 opens the details of the DOI row in a popover to the right
of the docked panel, level with the row, with the focus on **Insert**. Step 3
writes `{{ zt.DOI }}` at the cursor, closes the details, and the panel stays
docked; no command of Obsidian's runs, also when you have
bound your own hotkey to Ctrl+Enter. In step 4, the first `Escape` closes the
details, the second clears the search, and the third changes nothing: the
panel stays docked and the focus stays in the field search.

## Field details in the right leaf of a split

1. Open a Markdown note, and open the Template Workbench in a new leaf to its
   right, about 615 pixels wide. Choose "Alpha of the personal library".
2. Select **Fields**, and select the row of `title`.
3. Pin the panel (in a wider leaf if the pin is disabled), make the leaf
   about 615 pixels wide again, and select the row of `title`.

Expected: in steps 2 and 3 the details stand inside the Template Workbench
leaf, beside the Fields popover or the docked panel, and never over the note
in the left leaf. Where the side with more room is too narrow for them, they
overlap the edge of the Fields popover instead.

## The pin survives a restart

1. Pin the panel and widen it to 352 pixels.
2. Reload Obsidian (**Reload app without saving**).
3. Hide the panel with **Fields**, and reload Obsidian again.

Expected: after step 2 the Books Profile opens with the panel docked at the
left edge, 352 pixels wide. The focus stays where Obsidian puts it, not in the
panel. After step 3 the panel stays hidden, and **Fields** shows it again at
352 pixels. The web Workbench keeps the pin and the width while the page is
open, and a new page starts unpinned.

## Export from the Fields popover

1. Choose "Alpha of the personal library", and open the Annotation tab.
2. Open the pane menu.
3. Select **Fields**. In the popover, select **Back to note root**. Open the pane
   menu again, and select **Save template data as JSON**.
4. Close the popover, and open the pane menu.

Expected: in step 2 the pane menu offers **Export selected paper data**, as
the paper has no annotations. In step 3 it offers **Save template data as
JSON**, and the saved file holds the Note root the popover shows, not the
editor's Annotation root. With the popover closed (step 4), the entry exports
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
   the popover.
4. Make the window wide again.

Expected: at about 500 pixels the Preview moves under the editor, and
**Fields** opens the same popover at the right edge of the window as in a tab
of the main window. When the window is wide again, the Preview returns to the
right, and the popover stays as the reader left it.

## Show fields in the pane menu

1. In a tab narrower than 600 pixels, open the pane menu and select **Show
   fields**.
2. Open the pane menu again.
3. Select **Show fields**.
4. In a tab wider than 1040 pixels, do steps 1 to 3 again.

Expected: in step 1 the entry has no check mark. It opens the Fields popover
with the focus in its field search, as the **Fields** view action does. In
step 2 the entry shows a check mark. Step 3 closes the popover. Step 4 gives the
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

Expected: the Preview is on the left of the editor. In step 2 the Fields
popover opens at the right edge of the view, over the editor, as in a
left-to-right view. Step 3 closes it and gives the focus to **Fields**.
Pinned, the panel docks at the right edge, before the editor in reading
order, and `ArrowLeft` on its edge widens it.

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
Fields popover is open after either step. The web Workbench does the same steps.

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
popover stays closed. A second **Open template workbench** reveals that window
and opens no second one. Step 2 opens the Fields popover at the right edge of
the view.

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
In step 5 the Fields popover shows the editor's Item, "Within-library duplicate,
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
