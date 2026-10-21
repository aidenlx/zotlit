# Bases toolbar menus

This reference records how Obsidian builds the menus of the Bases toolbar: the Properties menu, the Views menu with its Configure view page, the Edit property page, and the formula pages. Use it to build a Bases-style menu, page, or form without repeating the reverse-engineering run.

## Scope and re-verification

The facts below were read from Obsidian **1.14.4**: `app.js`, `app.css`, and `i18n.js`, extracted to `node_modules/.ob-rev-1.14.4/`. The facts come from reading source; no running app was driven. The section [Not verified](#not-verified) lists the gaps.

Minified identifiers change in every release. The anchors that last are the `bases-*` class names, the CSS variables, and the English message keys in `i18n.js`.

To check a newer version:

1. Run `/obsidian-asar-extract` for that version.
2. From `node_modules/.ob-rev-<version>/`, run the searches below and compare with the sections of this file.

| Fact                                          | Search                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| Page host: `show`, `back`, `displayPage`      | `rg -n 'pageStack' app.js` (the match beside `bases-toolbar-menu-container-header`) |
| Header and form CSS                           | `rg -n 'bases-toolbar-menu-container-header\|bases-toolbar-menu-form' app.css`  |
| Properties page, Edit property page           | `rg -n 'bases-properties-page\|labelEditProperty' app.js`                       |
| Views page, Configure view page               | `rg -n 'bases-views-page\|view-config-menu' app.js`                             |
| Formula editor, status line, debounce         | `rg -n 'formula-editor-status' app.js app.css`                                  |
| Key dispatch                                  | `rg -n 'prototype.onKeyEvent\|prototype.handleKey' app.js`                      |
| Menu strings                                  | `rg -n 'actionSetDefaultView\|labelEditProperty\|actionDeleteFormula' i18n.js`  |
| Menu layers                                   | `rg -n 'layer-popover:\|layer-menu:' app.css`                                   |

## Page-stack model

Each toolbar button owns one **menu host**. The host holds a stack of **pages** and shows the last one.

```
toolbar button ── click ──▶ menu host (div.menu.bases-toolbar-menu on <body>)
                              pageStack = [ root, page, page, ... ]
                                            ▲                  ▲
                          no header here ───┘                  └── on screen
                          (header shows when the stack holds 2 or more pages)
```

- The root page is the list: Properties for the Properties button, Views for the Views button. A root page has no header.
- A page has a title, a list of action buttons, a container element, and its own key scope. The scope is a child of the host scope.
- `show(page)` calls `onHide` on the current page, pushes the new page and its key scope, and displays it.
- `back()` pops the page and its key scope, then displays the page below and calls its `onShow`. The page below keeps its element. A list page re-renders its rows in `onShow`, re-selects the search text, and moves the highlight to the first row.
- Display swaps the host's scroll element content in place, so one page container stands in the DOM at a time. The header is one shared element. For a page above the root it receives `[back button, ...page actions, close button]`, and it goes first in the page container. The back label shows the title of the page on screen, not of the page below.
- Opening the host (`setOpen(true)`) pushes the host scope, registers the click-outside handlers, and shows the root page. Closing (`setOpen(false)`) clears every page, pops every page scope, removes the click-outside handlers, and detaches the menu. When focus was inside the menu, it returns to the toolbar button.
- The host sets no width per page. The menu has `min-width: 220px` and the container has `max-width: 300px`, so content sets the width in between. A `ResizeObserver` positions the menu again when its size changes.
- On a phone, the host builds a sheet with its own header (back arrow, title, page actions, check button) in place of the in-page header.

Ways to enter a page:

| Entry                                              | Opens                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| Chevron or ArrowRight on a property row            | Edit property                                                      |
| Chevron or ArrowRight on a view row                | Configure view                                                     |
| Add "name" property row (Properties)               | Edit property, as a new property                                   |
| Add formula row (Properties)                       | Edit property, as a new formula                                    |
| Add view row (Views)                               | Configure view, as a new view                                      |
| Right-click on the Views toolbar button            | Views menu with Configure view of the current view above the list  |

## Anatomy

```
div.menu.bases-toolbar-menu                       --input-height: 28px · z-index var(--layer-popover) · min-width 220px
  div.menu-scroll                                 overflow-y: auto · padding: 0
    div.bases-toolbar-menu-container              flex column · max-width 300px · --icon-size var(--icon-s)
      div.bases-toolbar-menu-container-header     flex · padding var(--size-4-1)   (pages above the root only)
        div.back-button                           flex-grow 1 · gap/padding as below · hover: --background-modifier-hover
          div.back-icon                           lucide-chevron-left · color --text-muted
          div.back-label                          the page title · one line · ellipsis
        div.clickable-icon …                      one per page action, such as lucide-more-vertical
        div.close-icon.clickable-icon             lucide-x · padding --size-2-2 · --text-muted, hover --text-normal
      div.bases-toolbar-menu-form                 flex column · gap --size-4-2 · font --font-ui-small
        div.input-row                             no rule of its own: a block, so the label stands above the control
          div.input-row-label                     flex · color --text-normal · padding --size-2-2 --size-2-1
          div.input-row-content                   flex · width 100% · min-height var(--input-height)
            input | select | textarea | button | .combobox-button      flex-grow 1
```

### Header

| Part            | Declarations                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header          | `display: flex; padding: var(--size-4-1)`                                                                                                               |
| `.back-button`  | `display: flex; flex-grow: 1; align-items: center; gap: var(--size-4-1); padding: var(--size-2-2); font-size: var(--font-ui-small); font-weight: var(--font-medium); border-radius: var(--radius-s); corner-shape: var(--corner-shape)` |
| Back hover      | `background-color: var(--background-modifier-hover)`, under `@media (hover: hover)`                                                                     |
| `.back-icon`, `.close-icon` | `color: var(--text-muted)`; `.close-icon` adds `padding: var(--size-2-2)` and `--text-normal` on hover                                      |

The header holds a `.menu-title` rule next to `.back-button` with the same declarations. The pages read here use `.back-button`.

### Form

| Part                                  | Declarations                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `.bases-toolbar-menu-form`            | `display: flex; flex-direction: column; gap: var(--size-4-2); padding: var(--size-4-1) var(--size-4-2) var(--size-4-2); font-size: var(--font-ui-small); overflow-y: auto; min-height: 0` |
| `.input-row-label`                    | `display: flex; align-items: center; gap: var(--size-2-1); padding: var(--size-2-2) var(--size-2-1); color: var(--text-normal)` |
| `.input-row-content`                  | `display: flex; align-items: center; gap: 0 var(--size-4-1); width: 100%; min-height: var(--input-height)`            |
| Controls in `.input-row-content`      | `flex-grow: 1` on `.combobox-button`, `button`, `select`, `textarea`, `input`                                          |
| `.mod-error` on those controls        | `box-shadow: 0 0 0 var(--border-width) var(--background-modifier-error)`                                              |
| `.slider-value`                       | `padding: 0 var(--size-2-1)`                                                                                         |
| `.help-icon` (in a label)             | `--icon-size: var(--icon-xs); color: var(--text-faint); padding: var(--size-2-1) var(--size-2-2)`; a click opens the Bases functions page of the docs |

### Option groups

A layout can declare groups of options. A group renders as a collapsible section that starts collapsed.

| Part                      | Declarations                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `.input-group-container`  | `display: flex; flex-direction: column; gap: var(--size-4-2)`                                                         |
| `.input-group-divider`    | A rule that bleeds to the menu edges: `margin-inline: calc(var(--size-4-2) * -1); width: calc(100% + var(--size-4-4)); border-top: var(--border-width) solid var(--background-modifier-border)`. After an `.input-row`, `margin-top: var(--size-4-1)` |
| `.input-group-header`     | `display: flex; align-items: center; gap: var(--size-4-2); font-size: var(--font-ui-small); font-weight: var(--font-semibold)`; holds `.collapse-icon` (`is-collapsed`) and `.input-group-header-text`; a click expands or collapses |
| `.input-group-content`    | `display: flex; flex-direction: column; gap: var(--size-2-3)`                                                         |

### Formula editor

| Part                                   | Declarations                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `.formula-editor-container`            | `width: 100%`; holds `.formula-editor` and `.formula-editor-status`                                                    |
| `.formula-editor`                      | A CodeMirror 6 host drawn as a text area: `background-color: var(--background-modifier-form-field); border: var(--input-border-width) solid var(--background-modifier-border); border-radius: var(--textarea-radius, var(--input-radius))`; focus uses `--background-modifier-border-focus` and `--input-border-width-focus` |
| In the form                            | `resize: both; overflow: auto; min-width: 100%; max-width: 260px`; `.cm-content` has `min-height: calc(var(--input-height) * 3)`  |
| Text                                   | `.cm-scroller` uses `--font-monospace`, `--font-small`, `--code-normal`; the placeholder uses `--font-interface`, `--font-ui-small`, `--text-faint` |
| `.formula-editor-status`               | `display: flex; align-items: center; margin-top: var(--size-4-1); font-size: var(--font-ui-smaller); color: var(--text-success)`; `.mod-empty` uses `--text-faint`, `.mod-error` uses `--text-error`; `.status-icon` uses `--icon-xs` |
| In the Configure view form (`.view-config-menu`) | `.cm-content` has `min-height: var(--input-height)`, and the status line shows only with `.mod-error`                |

### Rows of a list page

A list page holds a raised search field (`.search-input-container.mod-raised`) and `.bases-toolbar-items` with one `.suggestion-item.bases-toolbar-menu-item` per row. A row holds `.bases-toolbar-menu-item-info` (an icon and the name), a checkbox on property rows, and a `.clickable-icon.bases-toolbar-menu-item-icon` with `lucide-chevron-right` that opens the row's page. Row declarations: `display: flex; align-items: center; gap: var(--size-4-2); width: 100%; padding: var(--size-2-2); padding-inline-start: var(--size-2-3); border-radius: var(--radius-s)`; hover uses `--background-modifier-hover`. Property rows prevent `mousedown`, so a press keeps focus in the search field. A visible property row and a view row reorder by drag.

### Pages and their rows

| Page                       | Title in the back label                                      | Rows                                                                                                                               |
| -------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Properties (root)          | none (no header)                                             | Search ("Find or create..."), property rows, then the actions Add "name" property (search text names no existing property), Add formula, Hide all |
| Views (root)               | none (no header)                                             | Search, view rows, Add view                                                                                                         |
| Edit property, existing    | `Edit {name}`, with the raw property name                    | Display name (label and text field); Property type (dropdown) for a note property; Formula (label with help icon, editor, status) for a formula |
| Edit property, new         | `Edit property`                                              | The first row has no label. Its text field sets the property or formula key (see [Save triggers](#save-triggers))                  |
| Configure view             | `Configure view`                                             | View name (text field, no label, placeholder "View name"); Layout (combobox); then the options the layout declares                 |

The option controls of Configure view are: dropdown, multi-text, slider, text, toggle, property combobox, file path, folder path, and formula editor. Each control sits in an `.input-row` under its label. After each change the page hides or shows rows by the layout's own rule, and a layout change rebuilds the whole form.

## Keyboard

Obsidian listens for `keydown` on the window in the capture phase. It looks for a handler in the scope chain: the page scope, then the host scope, then the app scope. A handler that returns `false` also calls `preventDefault` and `stopPropagation`. A handler that returns nothing ends the search without blocking the event, so the focused element's own key handler still runs afterwards.

| Key                                   | Where                              | Effect                                                                                                           |
| ------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Escape                                | List page (Properties, Views)      | The page has no handler, so the host scope closes the whole menu                                                   |
| Escape                                | Edit property page                 | The page scope calls `back()`, also when a field has focus                                                         |
| Escape                                | Configure view page                | `back()` only when focus is outside an `<input>` and a contenteditable element. In View name, Escape restores the saved name and blurs the field, and a second Escape goes back |
| Escape                                | Display name field                 | The field's own handler puts the raw property name (the placeholder) in the field and blurs it. See [Not verified](#not-verified) |
| ArrowRight                            | Property or view row               | Opens the page of the highlighted row. The Properties page ignores action rows                                      |
| Enter                                 | List page                          | Uses the highlighted row. Properties: toggles the property or runs the action. Views: selects the view and closes the menu; the Add view row opens Configure view |
| Enter                                 | Display name field                 | Blurs the field, which saves                                                                                       |
| Enter                                 | View name field                    | Blurs the field, which saves, unless a validation message shows                                                    |
| ArrowUp, ArrowDown, PageUp, PageDown, Home, End, Ctrl+P, Ctrl+N | List page | Move the highlight; ArrowUp on the first row wraps to the last                                       |
| Alt+ArrowUp, Alt+ArrowDown            | Properties page                    | Move the highlighted visible property one place in the column order                                                 |

ArrowLeft and Backspace have no handler in these page classes.

Focus:

- A page opens with its first text field focused and its text selected, when the device has a physical keyboard. A new view forces the selection.
- A list page selects its search text each time it shows, including after `back()`.
- Click-outside closes the host. The `…` menu is exempt, because it prevents `mousedown`.

## The `…` menu and the close button

**`…` button.** A page adds it with `addAction("lucide-more-vertical", callback)`. The header shows it between the back button and the close button. The two root pages have no header and no `…`.

- A click creates an Obsidian `Menu` with `Menu.forEvent(event)`, calls `setParentElement(button)`, and opens it at the pointer. A click on a button that already has `has-active-menu` does nothing.
- The menu uses the sections `["action", "", "danger"]`.
- The menu is its own `div.menu` on `<body>` at `--layer-menu` (65), above the Bases menu at `--layer-popover` (30). It prevents `mousedown`, so the Bases click-outside handler leaves the host open.

Items by page:

| Page                         | Item                                                    | Icon             | Section  | Effect                                                                                                                  |
| ---------------------------- | ------------------------------------------------------- | ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| Edit property                | Hide property or Show property (follows the column order) | `lucide-eye-off` | action   | Removes the property from the column order, or adds it                                                                  |
| Edit property (formula only) | Delete formula                                          | `lucide-trash-2` | danger, warning | Removes the formula from the column order, clears its display name, deletes it from `formulas`, then goes back one page |
| Configure view               | Default view                                            | `lucide-layers-2` | action  | A tick shows when the view is first in the list. A click moves the view to the first place and saves                     |
| Configure view               | Duplicate view                                          | `lucide-files`   | action   | Goes back, then shows a Configure view page for a copy with a unique name                                                |
| Configure view               | Delete view                                             | `lucide-trash-2` | danger, warning | Removes the view, selects the view before it (or the first), goes back, saves                                     |

**Close button.** The `×` calls `host.close()`, which closes the whole menu from any depth. The back button and Escape on a page move one level. Escape on a list page and a click outside the menu also close it.

## Save triggers

| Control                                   | Saves                     | Detail                                                                                                                                |
| ----------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Display name (existing property)          | On blur                   | Enter blurs. The value is trimmed. Nothing is written when it equals the current display name. It writes the display name of the property in the view |
| Display name field of a new property      | On blur                   | The value is the new key, not a display name. A new formula renames its entry in `formulas`; a new note property calls `fileManager.renameProperty`, which renames the property in the vault. The column order follows the new key |
| Property type                             | On change                 | Calls `metadataTypeManager.setType`                                                                                                    |
| Formula (Edit property and formula options) | After a 250 ms pause in typing, and on blur | Each change restarts a 250 ms debounce. Blur cancels the debounce and saves at once. A save writes the formula (on Edit property, through `query.setFormulas`) and updates the status line |
| Show or hide a property                   | On click                  | The row checkbox, or the Hide property item                                                                                            |
| View name                                 | On blur                   | Checked on every input: an empty name, a name with a forbidden character, and a name that another view uses each show a message as a tooltip on the field. A blur saves when the name is valid and either changed or the view is new. Enter blurs only when no message shows |
| Rename of a view                          | With the View name save   | Links of the form `[[base#old name]]` in the vault change to the new name, and a notice reports the count of links and files          |
| Layout and layout options                 | On change                 | A change of layout rebuilds the form and saves. Option controls write the option when they change; the page code has no commit step     |
| Delete formula, Delete view, Default view | On click                  | Immediate                                                                                                                              |

**New view.** The Add view row builds a view named from the search text, or "View" when the field is empty, made unique among the view names. The Configure view page shows it as new. The view joins the base only at the first valid blur of View name.

**Formula pages.** Add formula opens a page in the same menu. It picks a unique name from the search text, or "Untitled" when the field is empty, writes an empty formula, makes the property visible, and shows Edit property for it as a new property. The editor stands in the page. The `?` icon in the Formula label opens the docs page `bases/functions`. The status line reads "Valid formula" or "Invalid formula", with a `lucide-circle-check` or `lucide-x-circle` icon. Both texts are fixed English in the editor class, not message keys. The parse error shows as a tooltip on the status line.

## Comboboxes

Bases replaces a native `<select>` with one internal combobox class: a `PopoverSuggest` with a search field built in. It is not exported. The facts below come from the same `app.js` and `app.css` of 1.14.4.

- **Trigger.** `div.combobox-button` holds an icon (`.combobox-button-icon`, shown only when the chosen item has one), the label, and a `lucide-chevrons-up-down` chevron at `--icon-xs`. It shares the `select, .combobox-button, .dropdown` rule: `--input-height`, `--dropdown-background`, `--input-shadow`, `--input-radius`, with `--dropdown-padding: 0 var(--size-2-3) 0 var(--size-4-2)` and a `--size-2-2` gap. A click, an arrow key or a printable character opens it.
- **Popup.** `div.suggestion-container.combobox` on `<body>`: a "Search..." field always, with no item-count threshold, then the rows. A row is the item's icon if it has one, its title, and a check mark for the current value. The check comes first in the DOM but `order: 2` draws it at the end of the row. A query that matches nothing shows the field over an empty list.
- **Property variant.** The same class, with items for the query's properties. Every row has the property type's icon, and a muted raw id (`file.name`) at the end where the id is not the display name. The trigger shows the type icon before the display name. There are no group headings.
- **Which selects use it.** The filter property and operator, the sort and group-by property and direction, and the Configure page's layout and property options. The filter group's conjunction and a layout's `"dropdown"` options stay native selects.

ZotLit draws the same control with `Select` (`apps/obsidian/src/components/select.tsx`) on the Chooser, wearing no Obsidian class. An option's `icon` and `detail` give the property variant. ZotLit keeps a native select wherever the choices are a few fixed ones: the conjunction, a sort or group direction, the rows, the layout and the list markers. In the Match editor, a select is a `Select` only where `MatchSelect` is `searchable` and the theme supplies `matchSelect`.

### Keyboard and focus

What a popup control owes the keyboard, the screen reader and the pointer. `Select` meets each item. A new control that opens a Chooser, or any popover of its own, is held to the same list.

- **Opening.** ArrowDown and ArrowUp open it from the trigger. A printable key opens it searching for that key, with the first match highlighted. Space and Enter are the button's press.
- **Shutting.** Escape, a pick, and a press outside shut it. So does focus leaving the popup by keyboard, Shift+Tab back onto the trigger included, since an open popup's scope goes on taking the arrows and Enter. A press on the trigger is the popover's own toggle.
- **Claiming keys.** An open popup claims its keys on an Obsidian Scope, so the surface beneath needs no exception for it ([keyboard scope](../policies/keyboard-scope.md)).
- **Focus back.** A popup that shuts while it holds focus hands focus to its trigger. The browser restores focus only for the first popover of a stack, so a popup inside the Sort, Group or Filter popover does this itself, from a capture-phase `beforetoggle` listener (the Chooser unmounts its session in its own listener).
- **Names.** A combobox trigger carries `aria-controls` for the list box while the popup is open. The list box takes its name through `aria-labelledby`, since an `aria-label` on a container is a hover tooltip ([tooltips](../policies/tooltips.md)).
- **Placement.** The popup flips in both axes: `position-try-fallbacks: flip-block, flip-inline, flip-block flip-inline`.
- **Verifying.** Focus and dismissal are checked in the running app with trusted input, not untrusted `.click()` or `dispatchEvent` alone: see the obsidian-debug skill, "Trusted input".

## ZotLit mapping

`apps/obsidian/src/components/chooser.tsx` holds the ZotLit parts. The Query View consumers are in `apps/obsidian/src/views/query-view/` (`properties-menu.tsx`, `view-menu.tsx`, `configure-view.tsx`, `property-page.tsx`).

| Bases part                                                | Chooser part                                                                                                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Menu host and page stack                                  | The popup session. `useChooserPage()` returns `page`, `openPage`, `back`, `replacePage`. A page is a name; the last name is on screen; the rows are the root       |
| Opening a page from outside (right-click on Views button) | `useChooserOpenPage()`                                                                                                                                               |
| Page container, one at a time                             | `Chooser.Page` (`data-chooser-page`). It takes a render function of the page name, and it focuses the first field with its text selected                              |
| Header: back with title, actions, close                   | `Chooser.PageHeader` (`title`, `backLabel`, `closeLabel`, `actions`). Close ends the whole popup, as in Bases                                                         |
| `.bases-toolbar-menu-form`                                | `Chooser.PageForm`                                                                                                                                                   |
| `.input-row` with label above the control                 | `Chooser.PageField` (`label`, `description`, `invalid`, `after`). `inline` is a ZotLit addition; the Bases markup puts every control under its label                  |
| `…` button and its menu                                   | `Chooser.PageMenu` (`label`, `items`). A `warning` item follows a separator, as the danger section does                                                              |
| Row chevron and ArrowRight                                | `Chooser.Item`'s `end` slot for the chevron, and `ChooserRow.next` (`chooser-logic.ts`) for the ArrowRight action                                                    |
| Escape on a page goes back                                | The Escape handler of the popup session                                                                                                                              |
| Enter in a text field saves                               | `commitField` in the popup session: focus moves to the page, the field blurs and saves, and the form submits                                                          |
| Save on blur                                              | The field's own blur handler. `useChooserPageText` keeps the typed text, and `useChooserPageSave` runs the save as a page unmounts                                    |

Differences from Bases:

- **`…` menu surface.** Bases opens an Obsidian `Menu` at `--layer-menu`. `Chooser.PageMenu` opens a native `popover="auto"` nested in the popup, because an Obsidian `Menu` paints under the popup's top layer ([ADR 0044](adr/0044-menus-and-popovers-are-obsidians-own-primitives.md)). The icon is `more-horizontal`; Bases uses `lucide-more-vertical`.
- **Escape.** On a page, the popup steps back from any focus; when the `…` popover is open, its light dismiss closes it first. In Configure view, Bases reverts a focused text field first and goes back on the next Escape.
- **Unmount.** A Chooser page leaves the DOM with no blur event, so `useChooserPageSave` saves again as the page unmounts. Bases has no such hook.
- **`Chooser.PageGone`.** It steps back when a page's subject has left the file. Bases has no counterpart.

## Not verified

- Whether Escape in the Display name field of Edit property saves the raw property name. The page scope calls `back()` and returns nothing, so the field's own Escape handler still runs on the removed page; whether a blur event then reaches the blur handler was not run.
- ArrowRight on the Add view row: the handler passes the row's null view to the Configure view page; the outcome was not run.
- Phone behaviour beyond the `isPhone` branch of the host constructor.
- The size-change throttle in the host's `ResizeObserver`.
- Any page-swap animation: the display step contains none, and the CSS was not searched for a transition on the swap.
- When a layout option write reaches the file on disk.
