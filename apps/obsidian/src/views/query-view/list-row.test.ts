// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, onTestFinished } from "vitest";

import type { QueryViewValue } from "@/services/item-query/query-view";

import { prepareRow, rowHeight } from "./list-heights";
import type { ListMetrics } from "./list-heights";
import { LIST_LAYOUT_DEFAULTS } from "./list-layout";
import { drawListRow, listRowText } from "./list-row";
import type { ListRows } from "./list-row";
import type { RecordCells } from "./record-rows";
import type { PropertyEntry } from "./view-properties";

const property = (path: string): PropertyEntry => ({
  path,
  label: path,
  displayName: null,
  searchTerms: [],
  kind: "field",
  nested: false,
  formula: null,
  issue: null,
  fits: true,
  place: 0,
});

const PROPERTIES = ["title", "date", "itemType"].map(property);

/** A row of `PROPERTIES` that shows `cells`, each its own value. */
const record = (
  cells: readonly string[],
  values: Partial<Record<string, QueryViewValue>> = {},
): RecordCells => ({
  row: {
    indexedKey: "1:ITEMAAAA",
    values: Object.fromEntries(
      PROPERTIES.map(({ path }, at) => [path, values[path] ?? cells[at]!]),
    ),
  },
  cells,
  vault: cells.map(() => null),
});

const INLINE: ListRows = {
  properties: PROPERTIES,
  options: { ...LIST_LAYOUT_DEFAULTS, separator: " · " },
};
const INDENTED: ListRows = {
  properties: PROPERTIES,
  options: { ...LIST_LAYOUT_DEFAULTS, indentProperties: true },
};

describe("listRowText", () => {
  it("joins the shown properties on one line by the separator, and leaves an empty one out", () => {
    expect(listRowText(record(["A title", "", "Book"]), INLINE)).toEqual({
      first: "A title · Book",
      rest: [],
    });
  });

  it("puts each property after the first on a line of its own where they are indented", () => {
    expect(listRowText(record(["A title", "2020", "Book"]), INDENTED)).toEqual({
      first: "A title",
      rest: ["2020", "Book"],
    });
  });

  it("gives no text for a row that shows a vault property or an Error Value", () => {
    const vault: RecordCells = {
      ...record(["A title", "read", "Book"]),
      vault: [null, { note: true, value: "read" }, null],
    };
    const error = record(["A title", "Not a date", "Book"], {
      date: { kind: "error", code: "bad-date", message: "Not a date" },
    });
    expect(listRowText(vault, INLINE)).toBeNull();
    expect(listRowText(error, INLINE)).toBeNull();
  });
});

describe("a List row's predicted height", () => {
  // At 12px the stub gives each character 6px.
  const metrics = (width: number, size = 12): ListMetrics => ({
    font: `normal 400 ${size}px sans-serif`,
    lineHeight: 20,
    width,
    indent: 24,
    padding: 4,
  });
  const lines = (row: RecordCells, rows: ListRows, at: ListMetrics) =>
    (rowHeight(prepareRow(listRowText(row, rows)!, at.font), at) - at.padding) /
    at.lineHeight;
  // 28 characters on one line.
  const row = record(["A title of twenty characters", "", ""]);

  it("takes as many lines as its text wraps to at the list's width and font, and one line at least", () => {
    expect(lines(row, INLINE, metrics(180))).toBe(1);
    expect(lines(row, INLINE, metrics(60))).toBe(3);
    expect(lines(row, INLINE, metrics(180, 24))).toBe(2);
    expect(lines(record(["", "", ""]), INLINE, metrics(60))).toBe(1);
  });

  it("wraps each indented property line at the width less the indent", () => {
    // 10 characters a line at 60px; 6 at the 36px an indented line has.
    const indented = record(["A title", "12345678", "Book"]);
    expect(lines(indented, INDENTED, metrics(60))).toBe(1 + 2 + 1);
  });
});

describe("drawListRow", () => {
  /** The text of each line of `entry`'s row, as the Items Window draws it. */
  async function drawnLines(entry: RecordCells, rows: ListRows) {
    const host = document.createElement("ul");
    document.body.append(host);
    const root = createRoot(host);
    onTestFinished(async () => {
      await act(() => root.unmount());
      host.remove();
    });
    const { props, children } = drawListRow(entry, 0, rows);
    await act(() => root.render(createElement("li", props, children)));
    const li = host.querySelector("li[data-query-row]")!;
    const rest = [...li.querySelectorAll("[data-query-row-lines] > *")].map(
      (line) => line.textContent,
    );
    li.querySelector("[data-query-row-lines]")?.remove();
    return { first: li.textContent, rest };
  }

  it("draws the lines the row's text gives, on one line or indented", async () => {
    const entry = record(["A title", "", "Book"]);
    for (const rows of [INLINE, INDENTED])
      expect(await drawnLines(entry, rows)).toEqual(listRowText(entry, rows));
  });
});
