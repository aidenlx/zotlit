# Bases table cells: reproduction spec (Obsidian 1.14.4)

ZotLit decision: we do not reuse Bases classes or the property widgets. This section is the per-type spec for rebuilding them with Tailwind over Obsidian CSS variables. Line numbers are in `node_modules/.ob-rev-1.14.4/app.css` and `app.js`, and the evidence is in the sections after this one. The values in parentheses are default-theme values, for reference only. Use the variables.

## A. Shared cell box

| Aspect | Value (variable chain) | Source |
|---|---|---|
| Row height | `--bases-table-row-height` (30px). The view's rowHeight multiplies it: short 1, medium 2, tall 4, extra 8. When the multiplier is above 1 the container gets `.mod-multiline` | css 2065, js 167659 |
| Font size | `--bases-table-font-size` = `--font-smaller` (0.875em). It feeds `--metadata-input-font-size` | css 2066, 16198 |
| Font family | `--metadata-input-font` = `--font-interface` | 2582, 12896 |
| Text colour | `--metadata-input-text-color` = `--text-normal` | 2581, 13056 |
| Cell padding | `--input-padding` ← `--metadata-input-padding` = `--size-4-1 --size-4-2` (4px block, 8px inline). It sits on the inner text element, not on the td | 2588, 12887, 13059 |
| Height inside a row | single-line: `--input-height` = row height, `align-items:center`. multiline: `align-items:start` | 16521-16529, 16563 |
| Overflow | td `overflow:hidden; text-overflow:ellipsis; white-space:nowrap` (single-line) | 16458, 16525 |
| Column divider | `box-shadow: calc(var(--bases-table-column-border-width) * -1) 0 0 var(--table-border-color)` | 16458 |
| Row divider | `.bases-tr box-shadow: 0 calc(var(--bases-table-row-border-width) * -1) 0 var(--table-border-color)`. `--table-border-color` = `--background-modifier-border` | 16447, 2838 |
| Row hover | `--bases-table-row-background-hover` = `--table-row-background-hover` | 16342 |
| Body background | `--background-primary`. Group gap: `--bases-table-group-background` = `--background-primary-alt` | 16336, 2051 |
| Input chrome inside the table | none: `border:none; border-radius:0; box-shadow:none` on hover, active and focus. The background is transparent | 16204-16229, 12913-12935 |
| Placeholder | the "No value" text is present, but `--input-placeholder-color: transparent`, so empty cells look blank | 16202 |
| Read-only cell (non-md file) | `--bases-table-cell-background-disabled` = `--background-primary-alt`, no editor | 2074, 16455, js 130318 |

### Focus, edit and selection outlines

| State | CSS |
|---|---|
| **Editing** (focus inside the cell) | `.bases-td:focus-within { background: var(--bases-table-cell-background-active /* --background-primary */); border-radius: var(--bases-table-cell-radius-focus /* 2px */); box-shadow: var(--bases-table-cell-shadow-focus /* 0 0 0 2px var(--interactive-accent) */); z-index:1; height: fit-content; min-height: row-height }`. The cell grows downward over the rows below; **the row does not reflow**. Lists wrap and long text unwraps while focused. (16475) |
| **Active cell**, not editing, table focused | overlay `box-shadow: var(--bases-table-cell-shadow-active /* 0 0 0 2px var(--background-modifier-border-focus) */); border-radius: var(--bases-table-cell-radius-active /* 2px */)`. When a range exists the active cell uses the accent (focus) shadow (16552-16557). Only shown while the container has `:focus` |
| **Range** | fill `--bases-table-cell-background-selected` = `--table-selection` (`color-mix(in oklch, var(--color-accent) 10%, transparent)`), `mix-blend-mode: var(--table-selection-blend-mode)` (16558, 2860) |
| Focused pill | `:after` ring `0 0 0 1px var(--background-modifier-border-focus), inset 0 0 0 1px var(--background-modifier-border-focus)`, radius `--pill-radius`, width `--pill-focus-width` = `calc(100% + 6px)`, offset `--pill-focus-left-adjust` = -4px. For tags it is 100% / 0 (9594-9632, 13033) |

## B. Per type

**text** (also used for missing values on properties with no assigned type)
- Display: a single line, `white-space:nowrap; text-overflow:ellipsis; overflow:hidden` when not focused (16531). Padding is `--input-padding`.
- Editing: `white-space: pre-wrap; max-height: 300px; overflow-y:auto` while focused (13053-13064), so the cell grows to show every line.
- Value: `String(value ?? "")`.

**Links in text values** (`nN` js 97025)
- What counts as a link: a whole value that is a `[[wikilink]]`, `[text](url)`, a bare URL or an email.
- Display element: the value is replaced by `.metadata-link { display:flex; align-items:center; gap: var(--size-4-2); padding: var(--input-padding) }`. It contains:
  - `.metadata-link-inner { color: var(--link-color /* --text-accent */); text-decoration-line: var(--link-decoration); text-decoration-thickness: var(--link-decoration-thickness); nowrap; ellipsis }`. On hover it uses `--link-color-hover` and `--link-decoration-hover`.
  - an unresolved wikilink adds `.is-unresolved`, styled with `--link-unresolved-color` and `--link-unresolved-opacity` (0.7).
  - a trailing `lucide-pencil` flair, `--icon-xs` (14px), `opacity:0`, shown at `--icon-opacity` on hover (13069-13103).
- Text shown: the alias, or the title after `#`/`|`, not the raw `[[...]]`.
- Clicking the link opens it; Mod+click opens a new tab. Clicking the flair or the empty area swaps back to raw-text editing. Hovering fires `hover-link` (page preview), and it can be dragged as a link.
- A link inside a list pill is rendered the same way inside the pill content.
- Global link styling also applies, because the classes are set on `.metadata-link-inner`:
  - `.external-link` (13742): `color: var(--link-external-color)`; `text-decoration-line: var(--link-external-decoration)`; a trailing external-arrow background image (`background-size:0.825em`, `padding-inline-end:0.9em`, `background-position-y:0.25em`); `filter: var(--link-external-filter)`.
  - `.metadata-property-value .internal-link.is-unresolved` (13790) sets `color: var(--link-unresolved-color); opacity: var(--link-unresolved-opacity); filter: var(--link-unresolved-filter); text-decoration-style: var(--link-unresolved-decoration-style); text-decoration-color: var(--link-unresolved-decoration-color)`. On hover: `opacity:1; color: var(--link-color-hover); text-decoration-color: var(--link-color-hover); text-decoration-line: var(--link-decoration-hover)`.

**multitext / list and aliases** (pills; 9598-9690, 12936-12992)
- **Container**: `display:inline-flex; flex-wrap:wrap; gap: var(--size-2-3) (6px); min-height: var(--input-height); padding: var(--input-padding)`. No border or background; `align-items:center; overflow:hidden`.
  - Single-line, not focused: `flex: 0 0 auto; flex-wrap: nowrap` (16539). Overflow is **clipped by the td**: no per-pill ellipsis, no "+N" counter.
  - While editing it wraps.
- **Pill in a property cell**: `--pill-border-width:0; --pill-padding-x:0; --pill-padding-y:0; --pill-color: var(--metadata-input-text-color); line-height: var(--line-height-tight /* 1.3 */)`. A list item therefore reads as **plain text**: no background, border or padding. Items are separated only by the 6px gap.
  - Pill base: `display:flex; align-items:center; gap: var(--size-2-1); max-width: calc(100% - var(--size-2-3) - 1ch); border-radius: var(--pill-radius)`.
  - Pill content: `margin-inline-start: var(--pill-padding-x); overflow:hidden; word-break: break-word`.
- **Remove button**: lucide-x at `--icon-xs`, `color: var(--pill-color-remove /* --text-faint */)`, hover `--pill-color-remove-hover` (`--text-accent`), `margin-inline-end: min(var(--size-2-3), var(--pill-padding-x))`. It is **always visible**; no CSS hides it.
- **Hover** (generic pill): `--pill-background-hover`, `--pill-border-color-hover`, `--pill-color-hover` (`--text-normal`).
- **Invalid or duplicate entry**: `.is-invalid` uses `--text-error` with line-through. A duplicate just typed flashes `--text-warning` for 2s (`multi-select-duplicate`).
- **aliases**: same as multitext. Empty strings are marked invalid; values are trimmed; duplicates are prevented by exact match.

**tags** (13016-13034, variables 2875-2889)
- The pill takes the tag variables:
  - colour: `--tag-color` = `--text-accent` (hover `--tag-color-hover`); remove button: `--tag-color`
  - background: `--tag-background` = `color-mix(in oklch, var(--interactive-accent) 10%, transparent)`, hover `--tag-background-hover` (20%)
  - border: `--tag-border-color`, `--tag-border-width` (0px)
  - padding: `--tag-padding-y` (0.25em), `--tag-padding-x` (0.65em)
  - shape: `--tag-radius` (2em), `--tag-corner-shape` (round), `--tag-weight`, `--tag-decoration`
  - also `line-height:1; cursor: var(--cursor-link); --pill-focus-width:100%`.
- This makes **real chips** (unlike multitext).
- Display text has the leading `#` stripped. An invalid tag gets `.is-invalid` plus a tooltip.
- Clicking a tag opens global search `tag:<x>`. Typing auto-prefixes `#` for validation, and the value is stored as typed.

**number**
- `input[type=number]` with `inputmode=decimal` and `step=any`. Spin buttons are hidden (8728).
- Alignment: `justify-content:flex-end; text-align:right; font-variant-numeric: tabular-nums` (16516).
- Null is shown as an empty input. NaN also shows empty.

**checkbox**
- The cell is centred: `justify-content:center` (16512). Margin `var(--input-padding)`.
- Box: `appearance:none; width/height: var(--checkbox-size)` (`--font-preferred-size`; the 9306 override to `--font-ui-medium` is scoped to `.modal` only), radius `--checkbox-radius` (`--radius-s`), `1px solid var(--checkbox-border-color /* --text-faint */)`. Hover and focus use `--checkbox-border-color-hover`.
- **true**: fill and border `--checkbox-color` (`--interactive-accent`), with a check mask in `--checkbox-marker-color`.
- **false**: an empty bordered box.
- **null or missing** (`value == null`): `data-indeterminate="true"` draws a centred 2px bar `calc(var(--checkbox-size) - 6px)` wide in `--text-normal`, radius 2px (14457). After any toggle the indeterminate state clears.
- Keyboard focus ring: `0 0 0 2px var(--background-modifier-border-focus)` on `:focus-visible`.
- Missing values on properties with no assigned type render as text, not checkbox: the widget comes from the value via `getTypeInfo(...).inferred`.

**date / datetime**
- Element: native `<input type=date>` / `<input type=datetime-local>`. The **display format is the OS/Chromium locale** (for example mm/dd/yyyy). There is no moment formatting on display.
- Stored values: date as `YYYY-MM-DD`; datetime as `YYYY-MM-DD[T]HH:mm:ss`. datetime parsing also accepts `…THH:mm` and space-separated forms.
- `font-variant-numeric: tabular-nums`. Separators use `--input-date-separator` (`--text-faint`).
- **Icon**: the native `::-webkit-calendar-picker-indicator`, absolutely positioned at `left: var(--size-4-1)` with `opacity:0.5` (8742).
- **Daily-note button** (date only, only when the Daily Notes core plugin is enabled): a `lucide-link` icon button that opens that day's note. It is hidden when the date is invalid. In the table it shows only on td hover or focus (16499-16507).
- **Empty**: `.is-empty` sets the input to `opacity:0` until hover or focus; the date fields then show in `--input-placeholder-color`, and in `--text-normal` while focused (16488-16497, 8749-8762).

**unknown** (objects): a JSON span, `color: var(--text-warning)`, padding `--input-padding`, nowrap, ellipsis (12963).

**null / missing / empty summary**
- text and list: blank (transparent placeholder).
- number: blank input.
- date/datetime: invisible until hover.
- checkbox: null and missing are indeterminate; false is an empty box.
- Writes of `""` or `[]` are normalized to `null` (`eR`). If the key is absent and the new value is null, nothing is written.

## C. Edit interactions (detail and lines in section 2 below)

- **Starting an edit**
  - A single click on the value focuses the editor immediately. It is inline: contenteditable for text and the list input, native input otherwise.
  - Clicking the cell's own padding focuses with the caret at the end.
  - **Enter** on the active cell focuses with the caret at end. On a checkbox, Enter toggles and writes.
  - **Typing a printable key on the active cell does nothing**: there is no type-to-replace.
  - Double-click only edits an individual list pill.
- **Caret**: entering through Enter or a padding click uses `focus("end")`, which collapses the range at the end of the text. A native click places the caret where you clicked.
- **text**
  - Enter commits and exits.
  - Shift+Enter inserts a newline.
  - Escape reverts and exits.
  - Losing focus commits (`trimEnd`).
  - When the suggestion popover has a highlighted item, Enter takes the suggestion; Shift+Enter takes the raw text.
- **number**
  - Enter commits if valid, otherwise shows a "invalid number" tooltip (`displayTooltip`, class `mod-error`).
  - Escape reverts.
  - Blur commits if valid, otherwise reverts.
- **date/datetime**: Enter exits, and exiting commits if the value changed and is valid or empty. Escape reverts.
- **checkbox**: commits on every change.
- **lists** commit **per pill operation** (add, remove, edit), not on blur. Text, number and date commit **on Enter or blur, never per keystroke**.
- **After a commit**, focus returns to the table container and the active cell stays on the same cell; it does not move down.
- **Tab / Shift+Tab**, even inside an editor, commit (through blur) and move the active cell to the next or previous cell, wrapping rows.
- **Arrows, Home, End** inside an editor move the caret only.
- **List editor keyboard** (`QB`)
  - Enter with text adds a pill. Enter in an empty input does nothing in the widget itself.
  - Blur with pending text also adds it as a pill. Because of that, Escape effectively commits pending text: Escape calls blur.
  - Backspace in an empty input focuses the last pill; Backspace on a focused pill removes it and focuses the previous one.
  - ArrowLeft at the start of the input focuses the last pill. With a pill focused, ArrowLeft/ArrowRight move between pills, ArrowUp goes to the first, and ArrowDown or Escape go back to the input.
  - Enter or double-click on a pill edits it inline (Enter saves, Escape cancels).
  - **Commas are not separators.** There is no comma splitting, and paste inserts plain text.
  - Duplicates are rejected and the existing pill flashes.
  - The x and the context menu remove a pill.
- **Suggestions** open on focus with every vault value for that key, and narrow as you type (section 4).

---

# Evidence: rendering and editing internals

Source: `node_modules/.ob-rev-1.14.4/{app.js,app.css}` in the feat-zotquery-interop worktree. Line numbers refer to the oxfmt-formatted files.
Public export check (app.js 14664-14862): `_J` = `BasesView`, `EB` = `AbstractInputSuggest`, `bM` = `Component`, `Qy` = `Platform`, `LM` = `setIcon`, `oS` = `setTooltip`, `ZM` = `displayTooltip`. Every other name below is private.

## 0. Minified map

| Name | Meaning | Lines |
|---|---|---|
| `q7` (extends `_J` BasesView) | Table view: `containerEl` (tabIndex 0), `activeCell`, `selection`, keydown/paste/copy | 166324-167990 |
| `_J.createRenderer(prop, el)` | `file.name` → `YJ`; note property → `KJ`; formula/file.* → `XJ` | 130281 |
| `KJ` | Note-property cell renderer. Calls the property type widget | 130294-130342 |
| `XJ` / `YJ` | Read-only `bases-rendered-value` (formula values, file link) | 130343-130439 |
| `_J.updateProperty(file, key, v)` | `eR` normalize → `processFrontMatter` with undo transaction | 130096 |
| `X7` / `Y7` / `j7` / `U7` | Body cell / body row / row base / cell base (`.bases-td`) | 168016, 168304-168357 |
| `eN` | Widget base: `{containerEl, focus(mode), onFocus}` | 96996 |
| `tN`/`iN` | text widget + impl (contenteditable) | 97007, 97104 |
| `TN`/`rN` | multitext | 98068, 97199 |
| `mN`/`oN` | tags | 97677, 97272 |
| `gN`/`aN` | aliases | 97665, 97334 |
| `EN`/`CN` | number | 97780, 97735 |
| `MN`/`pN` | checkbox | 97791, 97568 |
| `wN`/`lN`, `kN`/`cN` (base `sN`) | date, datetime | 97713, 97724, 97376-97499 |
| `AN`/`DN` | unknown (JSON span) | 98110, 98079 |
| `QB` | `multi-select-container` pill widget | 95803-96124 |
| `SN` (extends `EB`) | Property value suggest (vault values + `[[` links) | 97802-97988 |
| `PN` (extends `EB`) | Tag suggest | 98121 |
| `eR` | `""` or `[]` → `null` | 89428 |
| `cE` | Blur `activeElement` and clear the DOM selection | 47851 |
| `eM` | Is it an INPUT or a contenteditable element? | 48411 |
| `zI` | Case-insensitive match against an existing frontmatter key | `function zI(` |
| `$B` | Normalize a list value: null/"" → null, scalar → [String] | 96125 |

## 1. Cell DOM and CSS per type

DOM for a note-property cell (`X7` 168331 + `KJ` 130300/130324):
```
div.bases-table-container[tabindex=0](.mod-multiline)(.is-selecting)
  div.bases-table > div.bases-tbody (--bases-table-row-height: H px)
    div.bases-tr  (absolute, top=row*H)
      div.bases-td[data-property="note.x"]   (absolute, inset-inline-start/width per column)
        div.bases-table-cell.bases-metadata-value.metadata-property-value[data-property-type=<inferred>]
          ...widget DOM...
    div.bases-table-active-cell(.mod-selection)   div.bases-table-selection   (overlays)
```
Non-`.md` entry: the cell is emptied and gets `disabled="true"` (130318). It shows `--bases-table-cell-background-disabled`.

Widget DOM (all appended into the `.metadata-property-value` element):
- **text** (`iN`): `div.metadata-input-longtext[contenteditable][tabindex=0][placeholder="No value"]`. If the value is a wikilink, markdown link, URL or email, it renders `div.metadata-link > div.metadata-link-inner(.internal-link|.external-link)(.is-unresolved) + div.metadata-link-flair(pencil)` instead (`nN` 97025, 97158). Clicking the link opens it. Clicking elsewhere calls `onFocus`, which swaps the input back in.
- **multitext** (`rN`→`QB`): `div.multi-select-container[tabindex=-1] > div.multi-select-pill[tabindex=0] > (div.multi-select-pill-content > text|link) + div.multi-select-pill-remove-button(lucide-x)` repeated, then `div.multi-select-input[contenteditable]` (96014-96117).
- **tags** (`oN`): same pills. The content is a `<span>` with the `#` stripped. A pill gets `.is-invalid` plus a tooltip when the tag is invalid. Clicking it opens global search `tag:`.
- **number**: `input.metadata-input.metadata-input-number[type=number][inputmode=decimal][step=any]`.
- **checkbox**: `input.metadata-input-checkbox[type=checkbox]`. A null value sets `data-indeterminate="true"`.
- **date**: `input.metadata-input.metadata-input-text.mod-date[type=date][max=9999-12-31](.is-empty)`. If Daily Notes is enabled it adds `div.clickable-icon` (lucide-link).
- **datetime**: `input.metadata-input.metadata-input-text.mod-datetime[type=datetime-local](.is-empty)`.
- **unknown**: `span.metadata-property-value-item.mod-unknown[tabindex=0]` showing the value as JSON.

Key CSS (app.css):
```css
/* 2065-2075 vars */
--bases-table-row-height: 30px; --bases-table-font-size: var(--font-smaller);
--bases-table-cell-shadow-focus: 0 0 0 2px var(--interactive-accent);          /* editing */
--bases-table-cell-shadow-active: 0 0 0 2px var(--background-modifier-border-focus); /* active, not editing */
--bases-table-cell-background-selected: var(--table-selection); /* accent 10% */
/* 16194 */ .bases-table-container { --metadata-input-font-size: var(--bases-table-font-size);
  --metadata-input-background-active: transparent; --metadata-input-longtext-lines: 1;
  --metadata-divider-width: 0px; --input-placeholder-color: transparent; }   /* empty = blank */
/* 16204-16229 */ inputs + .multi-select-container: border:none; radius 0; no box-shadow on hover/focus
/* 16447 */ .bases-tr { position:absolute; height: var(--bases-table-row-height); display:flex }
/* 16458 */ .bases-td { position:absolute; height: row-height; overflow:hidden; text-overflow:ellipsis;
   box-shadow: -1px 0 0 var(--table-border-color) }
/* 16475 */ .bases-td:focus-within { background: var(--background-primary); border-radius: 2px;
   box-shadow: 0 0 0 2px var(--interactive-accent); z-index:1; height: fit-content; min-height: row-height }
/* 16508 */ .bases-table-cell { display:flex; height:100%; width:100% }
/* 16512 */ .bases-table-cell[data-property-type="checkbox"] { justify-content:center }
/* 16516 */ .bases-table-cell .metadata-input-number, [data-property-type="number"] { justify-content:flex-end; text-align:right; font-variant-numeric: tabular-nums }
/* 16521-16542 single-line mode (:not(.mod-multiline)) */
  .bases-tr { --input-height: row-height }  .bases-td { white-space:nowrap; align-items:center }
  .metadata-input-longtext:not(:focus-within) { white-space:nowrap; text-overflow:ellipsis; overflow:hidden }
  .multi-select-container:not(:focus-within) { flex: 0 0 auto; flex-wrap: nowrap }
/* 16563 */ .mod-multiline .bases-table-cell { align-items:start }  .mod-multiline .metadata-input-longtext { overflow-y:auto }
/* 16488 */ .bases-td .metadata-input.mod-date.is-empty { opacity:0 } (opacity 1 on :hover/:focus-within, placeholder text-faint)
/* 16499 */ .bases-td .bases-metadata-value .clickable-icon { opacity:0 }  (1 on td :hover/:focus-within)
```
Inherited from the Properties panel (12886-13075):
- `.metadata-property-value` sets `--input-padding: var(--metadata-input-padding)` (= `--size-4-1 --size-4-2`, i.e. 4px 8px). It is `display:flex`, `align-items:center`, `overflow:hidden`.
- `.metadata-property-value .multi-select-pill` sets `--pill-border-width:0; --pill-padding-x:0; --pill-padding-y:0`. Plain multitext items therefore look like borderless text separated by the container `gap: var(--size-2-3)`, each with an x remove button (no CSS hides it).
- `[data-property-type="tags"] .multi-select-pill` maps the pill variables to the `--tag-*` variables, so tags look like real tag chips.
- `.multi-select-pill.is-invalid` is struck through in `--text-error`.
- `.metadata-input-longtext` has `white-space: pre-wrap; max-height: 300px; padding: var(--input-padding)`.
- `.metadata-link-inner` gets nowrap and ellipsis.

List values (multitext and tags) are never truncated per pill with an ellipsis. In single-line mode they stay on one line (`nowrap`) and the `.bases-td` clips whatever overflows. A pill can be at most `calc(100% - 6px - 1ch)` wide (9607). When the cell is focused the container wraps and the cell grows downward (`height: fit-content`). The **row never grows**: `.bases-tr` is absolutely positioned with a fixed height, so the focused cell (z-index 1) overlays the rows below.

Row height (167659-167675, 167834): `H = --bases-table-row-height (30) × {short 1, medium 2, tall 4, extra 8}` from the view config `rowHeight`. When `H > 1×`, the container gets `.mod-multiline` (167818). `--bases-table-cell-edge-padding` is defined (14752, 14857) but no table rule uses it. The real padding comes from `--input-padding`.

Empty values: text and lists show the "No value" placeholder, but its colour is transparent in the table, so the cell looks blank. date/datetime use opacity 0. checkbox shows the indeterminate state. number is an empty input with a transparent placeholder.

## 2. Editing

The edit is **inline, inside the widget**. text is a contenteditable div. multitext and tags use a contenteditable `.multi-select-input`. number, date and checkbox are native `<input>`. No overlay editor is created.

**Starting an edit**
- **Single click** on the widget focuses it natively. `pointerdown` (capture) on `.bases-td` only sets `activeCell` (167229).
- A click on the cell wrapper itself (`targetNode === .bases-table-cell`, i.e. its padding) calls `propertyEditor.focus("end")`. This is skipped for checkbox (168338-168346).
- **Enter** on the active cell (container focused) calls `focus("end")`. For a checkbox it toggles the value and writes it directly (166846-166869). For a formula it opens the formula editor.
- Typing a printable key on the active cell does **not** start an edit. Only Backspace/Delete are handled; they clear the selected cells (166917). Double-click only edits a list **pill** (96072).

**Keys inside an editor**
- **text** (97132):
  - Enter commits `textContent` and calls `ctx.blur()`.
  - Shift+Enter inserts a newline.
  - Escape reverts and calls `ctx.blur()`.
  - Losing focus commits the trimmed text (`trimEnd`).
  - When the value-suggest popover is open with a highlighted item, Enter picks the **suggestion**. Shift+Enter commits the raw text (97817, 97857).
- **number** (97751):
  - Enter commits if `validity.valid`; otherwise it shows a `displayTooltip` error.
  - Escape reverts.
  - Blur commits if valid, otherwise reverts.
- **date/datetime** (97389-97402):
  - The `input` event sets `dirty`.
  - Blur commits `format(date)` if dirty and either empty or valid. date is written as `YYYY-MM-DD`, datetime as `YYYY-MM-DD[T]HH:mm:ss`.
  - Enter blurs, which commits.
  - Escape reverts, then blurs.
- **checkbox**: `change` commits immediately. Enter and Escape blur.
- **Tab / Shift+Tab** is handled by the table *before* the editable-target guard (166708 vs 166737). It calls `preventDefault`, then `containerEl.focus()`, which blurs the editor and commits it. The active cell then moves right or left, wrapping across rows and groups. If an `SN` popover is open with a highlighted item, its Scope consumes Tab first (97820). That ordering is inferred, not traced through the keymap.
- **Arrows, Home, End, PageUp/PageDown** inside an editor: the table returns early (`eM(e.targetNode)`), so these keys move the caret.

**Where focus goes after a commit.** Bases' `ctx.blur` = `cE(); el.scrollLeft = 0; view.focus()` (130327). Focus returns to `.bases-table-container`, and the active cell stays on the **same** cell; Enter does not move down. The `focusin` handler on the container keeps `activeCell` in sync when focus enters a cell (166381).

**Write path.** `onChange(v)` → `eR(v)` → skip if `JSON.stringify` is unchanged → `view.updateProperty(file, key, v)` (130332-130335). That runs `processFrontMatter` with key `zI(fm, key)` (case-insensitive, reuses the existing key spelling). If the value is null and the key is absent, nothing is written. Otherwise `fm[key] = v`. Each write is pushed onto the view's undo stack (`createTransaction`); Mod+Z / Mod+Shift+Z undo and redo it (166913).

**Commit granularity.** List widgets call `onChange` on **every** pill add, remove or edit (`QB.triggerChange`), not on blur. text commits on Enter or blur. number and date commit on blur or Enter.

**List cell editing (`QB` 95803-96117)**
- **Input**: a trailing `div.multi-select-input[contenteditable]`. Clicking the empty area of the container focuses it.
- **Adding**: Enter with text, or blur with text, calls `addElement`. That runs `createOption` (multitext: identity; tags: adds `#` and validates, showing an error tooltip if invalid) and the duplicate check. A duplicate is not added; the existing pill flashes `.multi-select-duplicate` for 2 s.
- **Removing**:
  - Backspace in an empty input focuses the last pill. Backspace on a focused pill removes it and focuses the previous one.
  - Clicking the x removes a pill.
  - The context menu offers Edit, Copy and Remove.
- **Pill navigation**: ArrowLeft at the start of the input focuses the last pill. With a pill focused: ArrowLeft/ArrowRight go to the previous/next pill, ArrowUp goes to the first pill, ArrowDown and Escape go back to the input.
- **Editing a pill**: Enter or double-click on a pill swaps in an inline input. Enter commits, Escape cancels, and a blur with empty text restores the pill.
- **Commas**: there is no comma splitting. A comma is literal text and paste inserts plain text (`ZE`).
- **Escape in the input** calls `ctx.blur()`. `QB`'s own blur listener then adds any pending text as a pill, so Escape does not discard what you typed (97252 → `cE()` → blur listeners 95815/95837).

**Focus and selection rings.**
- Editing: `.bases-td:focus-within` gets a 2px `--interactive-accent` ring, 2px radius, `--background-primary` fill, z-index 1, and grows to fit.
- Active cell, not editing: the `.bases-table-active-cell` overlay is positioned in JS (167864-167881). While the container has `:focus` it shows a 2px `--background-modifier-border-focus` ring. With `.mod-selection` it shows the accent ring instead.
- Range: the `.bases-table-selection` overlay gets the `--table-selection` fill with `mix-blend-mode` (16555-16562).
- A focused pill gets its own 1px ring through `:after` (9624).

## 3. Does Bases use the property type widgets? Yes

`KJ.render` (130306-130338):
```js
var h = app.metadataTypeManager.getTypeInfo(name, raw).inferred;   // widget def, by actual value
if (!(this.propertyEditor && h === this.inferredType && this.val === JSON.stringify(raw))) {
  el.empty(); el.setAttr("data-property-type", h.type);
  this.propertyEditor = h.render(el, raw /* entry.getRawProperty(name) */, {
    app,
    blur() { cE(); el.scrollLeft = 0; view.focus(); },
    key: name,
    hoverSource: "bases",
    onChange(v) { v = eR(v); const s = JSON.stringify(v);
                  if (s !== this.val) { this.val = s; view.updateProperty(entry.file, name, v); } },
    sourcePath: entry.file.path,
  });
}
```
The Properties panel (96977-96991) passes the identical shape: `{app, key, onChange, sourcePath, blur, hoverSource}`. `metadataEditor` is **not** part of ctx in either caller. The only optional field is `filterSuggestion?: (text) => boolean`, which `SN` reads (97976). The element passed in is the container that also carries `metadata-property-value` and `data-property-type`; the widget appends into it.

**Calling it from a plugin.** `app.metadataTypeManager.registeredTypeWidgets[type].render(el, value, ctx)`, or `getTypeInfo(key, value).inferred.render(...)` / `getWidget(type).render(...)`, gives identical DOM, behaviour and suggestions. Requirements:
- **`ctx.key`**: must be a string. `SN` lowercases it (97816) and uses it for the value lookup.
- **`ctx.blur`**: must be a function. Every widget calls it on Enter or Escape (97137, 97139, 97252, 97318, 97360, 97400, 97516, 97582, 97755). Mirror Bases: blur the active element, clear the selection, and focus your table container.
- **`ctx.onChange`**: receives raw widget output. Normalize `""` and `[]` to null as `eR` does, dedupe with `JSON.stringify`, and write with `processFrontMatter`, matching the existing key case-insensitively (`zI`).
- **`ctx.sourcePath`**: used for link resolution and unresolved styling. **`ctx.hoverSource`**: used for `hover-link` page previews. **`ctx.app`**: also read (for example `vault.getConfig("spellcheck")`).
- **Keep the returned handle.** It is an `eN` subclass with `.type`, `.focus("start"|"end"|"both")`, `.setValue(v)`, `.containerEl` (plus `.inputEl`, `.multiselect` or `.checkboxEl`). Use it for Enter-to-edit, programmatic updates and the checkbox toggle.
- **Re-rendering.** Only re-render when the value JSON or the inferred type changes. Otherwise a vault-change re-render wipes an in-progress edit. Bases relies on setting `this.val` inside `onChange`; the Properties panel also checks whether `activeElement` is inside the value element (96965).
- **Widget choice.** It is `getTypeInfo(name, value).inferred`, not `.expected`. A value that does not match the assigned type renders with the inferred widget (for example text).

**What breaks or differs outside a Base or metadata editor**
- **Styling.** Without the `.bases-table-container` → `.bases-td` → `.metadata-property-value` ancestry you get the Properties-panel look: borders, 3-line clamp, visible placeholder, no single-line nowrap and no focus ring. To fork the look, copy app.css 16194-16570, 12886-13075 and 9598-9690. Reusing the `bases-*` class names is safe: Obsidian's delegated handlers are bound to the view's own `containerEl`, not the document. But `.bases-td` / `.bases-tr` assume absolute positioning and a fixed height.
- **Table behaviour.** Undo/redo, copy/paste of ranges, the active cell, Tab navigation and Enter-to-edit all live in `q7` / `_J`, not in the widgets. A plugin must reimplement them.
- **Lifecycle.** Widgets have no destroy method. Their suggests (`AbstractInputSuggest`) listen on the input element and close on blur, so emptying the element is enough cleanup.
- **Stability.** These are private APIs: `registeredTypeWidgets`, the ctx shape and the widget instance API are not in `obsidian.d.ts`, so they need guarded access, following the repo's `lib/obsidian-private/` pattern. `BasesView.createRenderer` and `updateProperty` exist on the public `BasesView` class at runtime but are undocumented. They are only usable inside a registered Bases view.

## 4. Value suggestion popovers

- **text and multitext**: `SN` (97802) extends the public `AbstractInputSuggest`.
  - It attaches to the contenteditable input. The popover gets `suggestEl.mod-property-value[data-property-key=<lc key>]`, limit 100. It opens on focus and on input, and closes on blur (94275).
  - Source: `app.metadataCache.getFrontmatterPropertyValuesForKey(key)` (91981, private). It collects every string value, or string inside an array, for that key across the vault cache, de-duplicated and sorted.
  - With an empty query it lists all values and nothing is preselected. Otherwise it matches the query as a **substring** of the whole value (`fx`, 65695) and sorts by `cx` (65649): `rea` lists read, reading, unread, to-read; `rd` lists nothing. This is not fuzzy search; only tags are fuzzy.
  - Typing `[[` switches to link suggestions (`WB` link manager, with `#` and `^` scope keys for headings and blocks).
  - Shift+Enter commits the raw text; Tab or Enter use the selected item. The instructions footer lists the link-note key and "esc: dismiss".
  - multitext filters out values already in the list (97217). The same suggest is attached to inline pill editors through `setupInputEl`.
- **tags**: `PN` (98121) suggests from `metadataCache.getTags()` via `KB` (95524), fuzzy, excluding tags already present. Tab completes the text without committing; Enter or a click adds the pill.
- Row styling: `.suggestion-container.mod-property-value .suggestion-item { font-size: var(--font-ui-small); padding: var(--size-2-3) var(--size-4-2) }` (10181). Wikilink values render as `mod-complex` with a link or alias flair (97886).

- **Chip menu**: right-clicking a pill opens a `Menu` with Edit (`pencil`), Copy, and Remove from list (warning). Edit swaps the pill for an inline field. There is no keyboard route: Shift+F10 or the menu key on a focused pill opens nothing.
- **Gotcha**: `Menu.showAtPosition` registers the menu's keys a `setTimeout(0)` after it shows. A menu closed before that timer fires leaves its keys registered, and they swallow Enter. Test input that picks a menu item must wait one timer after the menu opens.

## 5. Selection and keyboard navigation (summary, `q7` 166378-166973, 167229)

- **Model**: `activeCell {groupIdx,row,column}` and `selection {groupIdx,top,bottom,start,end}`. A selection never spans groups.
- **Rendering**: rows are virtualized (absolute, `top = row*H`), and the active-cell and selection overlays are positioned in JS (167864-167905). `SE(scrollEl, rect)` scrolls the active cell into view.
- **Mouse**: pointerdown sets the active cell. Shift+click extends the range. Dragging creates a range: it blurs any editor (`cE`), focuses the container, and adds `.is-selecting`, which sets `pointer-events: none` on cells.
- **Keyboard**: with no active cell, an arrow, Page, Home, End or Tab key starts at (0,0).
  - Arrows move the active cell; RTL-aware. Shift+Arrow extends the range.
  - Mod+Arrow jumps to the first or last column. Mod+Shift+Arrow extends to the edge.
  - Home and End go to the first and last column. PageUp/PageDown move by a viewport of rows and skip collapsed groups.
  - Ctrl+Space selects the column(s), Shift+Space the row(s), Mod+A everything in the group.
  - Escape clears the selection. Backspace/Delete clear the cell values.
- **Clipboard**: copy writes TSV, markdown, html, `obsidian/table` and `obsidian/bases-cells` (166445). Paste writes frontmatter across the range (166511). A single plain value is **appended** to array properties.
