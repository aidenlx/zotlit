---
status: accepted
---

# A Table column takes its header's width, never its content's

Every property column of a Query View Table is as wide as its header cell says: the width the researcher set, else a fixed default. The first column defaults to `--bases-table-column-max-width` (300 px), the widest a Bases column grows by itself, where a title reads; every later column defaults to half of that. A body cell takes no room of its own and clips what does not fit with an ellipsis, as a column the researcher sized did before. Cells that span the columns, a group's heading and the rows under an expanded Item, clip too.

A long Table mounts only the rows near the screen (PR #2023). A column that sized itself to its content took the width of the rows mounted at the moment, so it changed width while the researcher scrolled: one column went from 317 px to 222 px on a 1,000-row Table, and the header cells and resize handles moved under the pointer (issue #2024). A default that depends on nothing but the column's place is the only rule whose widths do not follow the scroll position or its history, and the browser does the least layout work for it.

## Consequences

- An empty filler column after the last takes the room the columns leave in a wide pane, so the row lines reach the pane's edge. Without it, the browser spreads that room over every column, the gutter included, and no column shows the width it was given. It is `aria-hidden`, and the cells that span the columns span it too.
- One rule for every Table, short ones included. A Table of 100 entries or fewer, which keeps every row, looks the same as a long one.
- Text that fit in an unsized column before can now end in an ellipsis; a wide value no longer widens its column. The researcher drags the column's edge to show more, and the width saves as before (`columnSize`).
- A saved width never holds a default: `columnSize` keeps only the widths the researcher set, and Reset column width removes one. The header's `data-sized` mark still says which widths were set; no style reads it.
- A theme that changes `--bases-table-column-max-width` changes the defaults with it, as it changes Bases' own columns.

## Considered options

- **Accept the moving columns.** No code, but the header moves under the pointer during a scroll.
- **Grow only**: keep the widest width each column reached. The width then depends on the scroll history, `min-w-full` stretching in a wide pane becomes the floor, and it needs resets on pane width and on a change of columns.
- **Hold the widths of the first window, long Tables only.** Later, longer text is cut, it needs a new measurement on pane resize and on a change of columns, and short and long Tables follow different rules.
- **Measure each column's longest value, as Bases does.** Bases measures the header and the value with the most characters across all rows, clamped to 40–300 px. For a Query View that means rendering a measuring row for every column after each result and each change of columns, and the widest-looking value is not always the one with the most characters.
