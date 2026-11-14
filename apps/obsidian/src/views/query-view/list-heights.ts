// The height of each List row before it is drawn. A List row wraps, so its
// height follows its text and the list's width, and a long list that took
// one height for every row it had not drawn grew and shrank as its rows came
// into view, moving the scroll bar away from the pointer. Pretext measures a
// row's text once with the canvas and lays it out at the list's width by
// arithmetic, as the browser wraps it (`overflow-wrap: break-word`); a row
// whose cells show more than text keeps the height its kind measures.
import { clearCache, layout, prepare } from "@chenglou/pretext";
import type { PreparedText } from "@chenglou/pretext";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import { yieldToMain } from "@/lib/yield-to-main";

/** What a List row's height follows beside its text, as a drawn row shows it. */
export interface ListMetrics {
  /** The rows' font, as the canvas takes it. */
  readonly font: string;
  readonly lineHeight: number;
  /** The width a row's text wraps at. */
  readonly width: number;
  /** How far an indented row's property lines stand in from its first line. */
  readonly indent: number;
  /** A row's padding, top and bottom together. */
  readonly padding: number;
}

/** The text of a row: its first line, and the property lines below it where they stand apart. */
export interface RowText {
  readonly first: string;
  readonly rest: readonly string[];
}

/** A row's text as the canvas measured it. */
export interface PreparedRow {
  readonly first: PreparedText;
  readonly rest: readonly PreparedText[];
}

/**
 * The height of a row: its padding, its first line's text, and each
 * property line's text at the indented width. A text takes a line at least,
 * as the row's marker does.
 */
export function rowHeight(row: PreparedRow, metrics: ListMetrics): number {
  const { lineHeight, width, indent, padding } = metrics;
  const block = (text: PreparedText, at: number) =>
    Math.max(layout(text, at, lineHeight).height, lineHeight);
  return (
    padding +
    block(row.first, width) +
    row.rest.reduce((sum, text) => sum + block(text, width - indent), 0)
  );
}

/** Whether two readings of the rows' metrics lay the rows out alike. */
export function sameMetrics(a: ListMetrics | null, b: ListMetrics | null) {
  if (a === null || b === null) return a === b;
  const near = (x: number, y: number) => Math.abs(x - y) < 0.01;
  return (
    a.font === b.font &&
    near(a.lineHeight, b.lineHeight) &&
    near(a.width, b.width) &&
    near(a.indent, b.indent) &&
    near(a.padding, b.padding)
  );
}

/**
 * The metrics of the rows of `list`, read from a drawn row; `null` while it
 * draws none, or its line height is not a length.
 */
export function readListMetrics(list: HTMLElement): ListMetrics | null {
  const row = list.querySelector<HTMLElement>("li[data-query-row]");
  if (!row) return null;
  const style = row.win.getComputedStyle(row);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (!Number.isFinite(lineHeight)) return null;
  const lines = list.querySelector<HTMLElement>("[data-query-row-lines]");
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

/** The rows a task prepares before it lets the window draw. */
const PREPARE_BATCH = 250;

/**
 * The height of each row of `texts` at `metrics`, or `null` for one with no
 * text of its own; `null` for all of them until every text is prepared.
 * The texts are prepared a batch at a time between tasks, again for a new
 * font, and again once a font loads, since the canvas measured its
 * fallback until then.
 */
export function useRowHeights(
  texts: readonly (RowText | null)[],
  metrics: ListMetrics | null,
  doc: Document | null,
): readonly (number | null)[] | null {
  const font = metrics?.font ?? null;
  const [fonts, setFonts] = useState(0);
  useLayoutEffect(() => {
    if (!doc) return;
    const loaded = () => {
      clearCache();
      setFonts((count) => count + 1);
    };
    doc.fonts.addEventListener("loadingdone", loaded);
    return () => doc.fonts.removeEventListener("loadingdone", loaded);
  }, [doc]);

  const [prepared, setPrepared] = useState<{
    texts: readonly (RowText | null)[];
    font: string;
    fonts: number;
    rows: readonly (PreparedRow | null)[];
  } | null>(null);
  useEffect(() => {
    if (font === null) return;
    let stopped = false;
    void (async () => {
      const rows: (PreparedRow | null)[] = [];
      for (let at = 0; at < texts.length; at += PREPARE_BATCH) {
        if (at > 0) await yieldToMain();
        if (stopped) return;
        for (const text of texts.slice(at, at + PREPARE_BATCH))
          rows.push(
            text && {
              first: prepare(text.first, font),
              rest: text.rest.map((line) => prepare(line, font)),
            },
          );
      }
      if (!stopped) setPrepared({ texts, font, fonts, rows });
    })();
    return () => {
      stopped = true;
    };
  }, [texts, font, fonts]);

  return useMemo(() => {
    if (
      metrics === null ||
      prepared === null ||
      prepared.texts !== texts ||
      prepared.font !== metrics.font ||
      prepared.fonts !== fonts
    )
      return null;
    return prepared.rows.map((row) => row && rowHeight(row, metrics));
  }, [prepared, texts, metrics, fonts]);
}
