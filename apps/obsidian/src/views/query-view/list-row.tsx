// One List row: the lines it draws, the text of those lines, and its height
// before it is drawn. The markup and the text follow one split of the row's
// cells into lines, and the font and width a height follows are read from
// the elements drawn here, so a change to a row's lines reaches its height.
// `list-heights.ts` lays the text out at those metrics.
import { Fragment, useMemo, useState } from "react";

import type { DrawnEntry } from "./items-window";
import { sameMetrics, useRowHeights } from "./list-heights";
import type { ListMetrics, RowText } from "./list-heights";
import type { ListLayoutOptions } from "./list-layout";
import { RecordCell, holdsError } from "./record-rows";
import type { GroupEntry, RecordCells } from "./record-rows";
import type { PropertyEntry } from "./view-properties";

/** The attribute of a List row, which holds its Indexed Key. */
const ROW = "data-query-row";
/** The attribute of an indented row's property lines. */
const LINES = "data-query-row-lines";

/** What each row of one List draws by. */
export interface ListRows {
  /** The view's properties, which a row's cells show by their place. */
  readonly properties: readonly PropertyEntry[];
  readonly options: ListLayoutOptions;
}

/**
 * The cells a row shows, by their place: an empty property takes no place
 * on the line, but an Item with no note to read a vault property from shows
 * that it has none.
 */
function shownCells({ cells, vault }: RecordCells): number[] {
  return cells.flatMap((text, cell) =>
    text === "" && vault[cell]?.note !== false ? [] : [cell],
  );
}

/**
 * The cells of a row's first line, the separator between each two, and of
 * each property line below it, where the properties after the first stand
 * on lines of their own.
 */
function rowLines(
  record: RecordCells,
  indentProperties: boolean,
): { first: number[]; rest: number[] } {
  const cells = shownCells(record);
  return indentProperties
    ? { first: cells.slice(0, 1), rest: cells.slice(1) }
    : { first: cells, rest: [] };
}

/**
 * The text of each line a row shows, for its height before it is drawn;
 * `null` where a cell shows more than its text: a vault property, or an
 * Error Value's icon.
 */
export function listRowText(
  record: RecordCells,
  { properties, options: { indentProperties, separator } }: ListRows,
): RowText | null {
  const { first, rest } = rowLines(record, indentProperties);
  for (const cell of [...first, ...rest])
    if (
      record.vault[cell] ||
      holdsError(record.row.values[properties[cell]!.path])
    )
      return null;
  const text = (cell: number) => record.cells[cell]!;
  return { first: first.map(text).join(separator), rest: rest.map(text) };
}

/** One List row at its place `at` in its group, as the Items Window draws it. */
export function drawListRow(
  record: RecordCells,
  at: number,
  { properties, options: { markers, indentProperties, separator } }: ListRows,
): DrawnEntry {
  const { first, rest } = rowLines(record, indentProperties);
  const cell = (place: number) => (
    <RecordCell
      key={properties[place]!.path}
      record={record}
      properties={properties}
      at={place}
    />
  );
  const firstLine = first.map((place, part) => (
    <Fragment key={part}>
      {part > 0 && (
        <span className="zt:text-muted-foreground">{separator}</span>
      )}
      {cell(place)}
    </Fragment>
  ));
  return {
    props: {
      value: markers === "number" ? at + 1 : undefined,
      className: "zt:py-(--list-spacing)",
      [ROW]: record.row.indexedKey,
    },
    children: indentProperties ? (
      <>
        <span>{firstLine}</span>
        {rest.length > 0 && (
          <span
            className="zt:block zt:pl-(--list-indent) zt:text-muted-foreground"
            {...{ [LINES]: "" }}
          >
            {rest.map((place, line) => (
              <span key={line} className="zt:block">
                {cell(place)}
              </span>
            ))}
          </span>
        )}
      </>
    ) : (
      firstLine
    ),
  };
}

/**
 * The metrics of the rows of `box`, read from a drawn row; `null` while it
 * draws none, or its line height is not a length.
 */
function readListMetrics(box: HTMLElement): ListMetrics | null {
  const row = box.querySelector<HTMLElement>(`li[${ROW}]`);
  if (!row) return null;
  const style = row.win.getComputedStyle(row);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (!Number.isFinite(lineHeight)) return null;
  const lines = box.querySelector<HTMLElement>(`[${LINES}]`);
  const indent = lines
    ? Number.parseFloat(lines.win.getComputedStyle(lines).paddingInlineStart)
    : 0;
  return {
    font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
    lineHeight,
    width:
      row.clientWidth -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight),
    indent,
    padding:
      Number.parseFloat(style.paddingTop) +
      Number.parseFloat(style.paddingBottom),
  };
}

/**
 * The height of each List entry before it is drawn, from its text, at the
 * font and width the rows drawn in `box` show: `null` for a heading or a row
 * that shows more than text, and for all of them until the texts are
 * prepared. `read` reads the drawn rows; run it after each draw of the
 * window, as a scroll or a resize draws it. `metrics` are the ones last read.
 */
export function useListRowHeights(
  box: HTMLElement | null,
  entries: readonly GroupEntry[],
  { properties, options }: ListRows,
): {
  heights: readonly (number | null)[] | null;
  metrics: ListMetrics | null;
  read: () => void;
} {
  const { markers, indentProperties, separator } = options;
  const [metrics, setMetrics] = useState<ListMetrics | null>(null);
  const texts = useMemo(
    () =>
      entries.map((entry) =>
        entry.kind === "heading"
          ? null
          : listRowText(entry.record, {
              properties,
              options: { markers, indentProperties, separator },
            }),
      ),
    [entries, properties, markers, indentProperties, separator],
  );
  const heights = useRowHeights(texts, metrics, box?.doc ?? null);
  const read = () => {
    const drawn = box && readListMetrics(box);
    if (drawn && !sameMetrics(drawn, metrics)) setMetrics(drawn);
  };
  return { heights, metrics, read };
}
