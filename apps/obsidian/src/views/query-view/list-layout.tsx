// The List layout: one line for each row of any Query Dataset, its visible
// properties in the view's order, as the List layout of Bases draws a note.
// Its options are those of Bases 1.14.4: `markers`, `indentProperties` and
// `separator`.
import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

import { useUniqueId } from "@zotlit/ui";

import { Chooser } from "@/components/chooser";
import { Dropdown, DropdownItem } from "@/components/obsidian/dropdown";
import { Toggle } from "@/components/obsidian/toggle";
import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";

import { useItemsWindow } from "./items-window";
import type { WindowEntry } from "./items-window";
import type { QueryLayout } from "./layouts";
import { readListMetrics, sameMetrics, useRowHeights } from "./list-heights";
import type { ListMetrics, RowText } from "./list-heights";
import { useQueryViewState } from "./model";
import type { QueryFileView } from "./query-file";
import {
  HEADING_ESTIMATE,
  RecordCell,
  RecordGroupHeading,
  groupEntries,
  holdsError,
  useRecordGroups,
} from "./record-rows";
import type { RecordCells } from "./record-rows";
import type { QueryView } from "./view";
import type { PropertyEntry } from "./view-properties";
import { LIST_GHOST, ListSpacer, placeholderRow } from "./virtual-spacers";

export const LIST_LAYOUT: QueryLayout = {
  type: "list",
  datasets: ["annotations", "attachments", "items"],
  name: () => m.query_view_layout_list(),
  icon: "list",
};

export const LIST_MARKERS = ["bullet", "number", "none"] as const;
export type ListMarker = (typeof LIST_MARKERS)[number];

export interface ListLayoutOptions {
  /** What opens each line. */
  readonly markers: ListMarker;
  /** Whether the properties after the first stand on lines of their own, below it. */
  readonly indentProperties: boolean;
  /** What stands between two properties on one line. */
  readonly separator: string;
}

export const LIST_LAYOUT_DEFAULTS: ListLayoutOptions = {
  markers: "bullet",
  indentProperties: false,
  separator: ", ",
};

/** The List layout's options a view holds; a key it lacks or cannot hold takes its default. */
export function listLayoutOptions(
  view: QueryFileView | null,
): ListLayoutOptions {
  const source = view?.source ?? {};
  const markers = source.markers;
  return {
    markers: (LIST_MARKERS as readonly unknown[]).includes(markers)
      ? (markers as ListMarker)
      : LIST_LAYOUT_DEFAULTS.markers,
    indentProperties:
      typeof source.indentProperties === "boolean"
        ? source.indentProperties
        : LIST_LAYOUT_DEFAULTS.indentProperties,
    separator:
      typeof source.separator === "string" && source.separator !== ""
        ? source.separator
        : LIST_LAYOUT_DEFAULTS.separator,
  };
}

/** The List layout's options in "Configure view". */
export function ListLayoutFields({
  options,
  set,
}: {
  options: ListLayoutOptions;
  set: (key: keyof ListLayoutOptions, value: unknown) => void;
}) {
  const labels: Record<ListMarker, () => string> = {
    bullet: m.query_view_list_marker_bullet,
    number: m.query_view_list_marker_number,
    none: m.query_view_list_marker_none,
  };
  const indentLabelId = useUniqueId();
  return (
    <>
      <Chooser.PageField label={m.query_view_list_markers()}>
        <Dropdown
          value={options.markers}
          data-query-view-option="markers"
          onChange={(value) =>
            set(
              "markers",
              value === LIST_LAYOUT_DEFAULTS.markers ? undefined : value,
            )
          }
        >
          {LIST_MARKERS.map((marker) => (
            <DropdownItem key={marker} value={marker}>
              {labels[marker]()}
            </DropdownItem>
          ))}
        </Dropdown>
      </Chooser.PageField>
      <Chooser.PageField
        label={m.query_view_list_indent_properties()}
        labelId={indentLabelId}
        inline
      >
        <span className="zt:flex" data-query-view-option="indentProperties">
          <Toggle
            value={options.indentProperties}
            aria-labelledby={indentLabelId}
            onChange={(value) => set("indentProperties", value)}
          />
        </span>
      </Chooser.PageField>
      {/* The separator shows only where the properties share one line. */}
      {!options.indentProperties && (
        <Chooser.PageField label={m.query_view_list_property_separator()}>
          <input
            type="text"
            value={options.separator}
            placeholder={LIST_LAYOUT_DEFAULTS.separator}
            data-query-view-option="separator"
            onInput={(event) => {
              const value = event.currentTarget.value;
              set("separator", value === "" ? undefined : value);
            }}
          />
        </Chooser.PageField>
      )}
    </>
  );
}

/** The height of a List entry of each kind, before it is measured. */
const ESTIMATES = { heading: HEADING_ESTIMATE, row: 28 };

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
 * The text a row shows, for its height before it is drawn; `null` where a
 * cell shows more than its text: a vault property, or an Error Value's icon.
 */
function rowText(
  record: RecordCells,
  properties: readonly PropertyEntry[],
  { indentProperties, separator }: ListLayoutOptions,
): RowText | null {
  const texts: string[] = [];
  for (const cell of shownCells(record)) {
    if (
      record.vault[cell] ||
      holdsError(record.row.values[properties[cell]!.path])
    )
      return null;
    texts.push(record.cells[cell]!);
  }
  if (!indentProperties) return { first: texts.join(separator), rest: [] };
  const [first = "", ...rest] = texts;
  return { first, rest };
}

/**
 * The rows of the shown view under their group headings, each wrapping to
 * the lines its text takes. The groups share one list: numbers count each
 * group's rows from one.
 */
export function ListLayout({ view }: { view: QueryView }) {
  const { properties, groups } = useRecordGroups(view);
  const options = listLayoutOptions(useQueryViewState(view, (s) => s.view));
  const { markers, indentProperties, separator } = options;
  const entries = useMemo(() => groupEntries(groups), [groups]);

  // A row's height before it is drawn, from its text, at the font and width
  // its drawn rows show.
  const [list, setList] = useState<HTMLElement | null>(null);
  const [metrics, setMetrics] = useState<ListMetrics | null>(null);
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- reads the drawn rows after each draw
  useLayoutEffect(() => {
    const read = list && readListMetrics(list);
    if (read && !sameMetrics(read, metrics)) setMetrics(read);
  });
  const texts = useMemo(
    () =>
      entries.map((entry) =>
        entry.kind === "heading"
          ? null
          : rowText(entry.record, properties, {
              markers,
              indentProperties,
              separator,
            }),
      ),
    [entries, properties, markers, indentProperties, separator],
  );
  const heights = useRowHeights(texts, metrics, list?.doc ?? null);

  const rows = useItemsWindow(
    view,
    useMemo(
      () =>
        entries.map((entry, index): WindowEntry => {
          if (entry.kind === "heading")
            return { key: entry.key, kind: "heading", item: null };
          const height = heights?.[index] ?? null;
          return {
            key: entry.key,
            kind: "row",
            item: entry.record.row.indexedKey,
            ...(height !== null && { height }),
          };
        }),
      [entries, heights],
    ),
    {
      estimates: ESTIMATES,
      fallback: ESTIMATES.row,
      // A row's lines follow the options, the properties it shows, and the
      // width and font it wraps at.
      shape: JSON.stringify([
        options,
        properties.map(({ path }) => path),
        metrics && [Math.round(metrics.width), metrics.font],
      ]),
    },
  );
  const { list: windowList } = rows;
  const listRef = useCallback(
    (el: HTMLElement | null) => {
      windowList(el);
      setList(el);
    },
    [windowList],
  );
  // Numbers count the rows of a list; bullets and none mark no order.
  const List = options.markers === "number" ? "ol" : "ul";
  return (
    <div
      ref={rows.box}
      className="zt:min-h-0 zt:flex-1 zt:overflow-auto zt:px-3 zt:pt-2 zt:pb-11 zt:[overflow-anchor:none] zt:in-[.zt-query-note]:pb-2"
      data-query-layout="list"
      style={placeholderRow(rows.learned.get("row") ?? ESTIMATES.row)}
    >
      {/* A word too long for the line breaks, as `list-heights.ts` lays it out. */}
      <List
        ref={listRef}
        className={cn(
          "zt:my-0 zt:py-1 zt:text-(length:--font-smaller) zt:wrap-break-word zt:marker:text-(--list-marker-color)",
          options.markers === "bullet" && "zt:list-disc zt:pl-(--list-indent)",
          options.markers === "number" &&
            "zt:list-decimal zt:pl-(--list-indent)",
          options.markers === "none" && "zt:list-none zt:pl-0",
        )}
        data-query-markers={options.markers}
        onFocus={rows.onFocus}
      >
        {rows.entries.map(({ index, before }) => {
          const entry = entries[index]!;
          if (entry.kind === "heading")
            return (
              <Fragment key={entry.key}>
                {before > 0 && (
                  <ListSpacer height={before} ghost={LIST_GHOST} />
                )}
                {/* The heading stands at the list's start edge, out of the
                    indent the markers take. */}
                <li
                  ref={rows.measure}
                  data-index={index}
                  className={cn(
                    "zt:list-none",
                    options.markers !== "none" && "zt:-ml-(--list-indent)",
                    index > 0 && "zt:pt-2",
                  )}
                >
                  <RecordGroupHeading group={entry.group} />
                </li>
              </Fragment>
            );
          const { record, at } = entry;
          const { row } = record;
          const filled = shownCells(record).map((cell) => (
            <RecordCell
              key={properties[cell]!.path}
              record={record}
              properties={properties}
              at={cell}
            />
          ));
          const [first = "", ...rest] = filled;
          return (
            <Fragment key={entry.key}>
              {before > 0 && <ListSpacer height={before} ghost={LIST_GHOST} />}
              <li
                ref={rows.measure}
                data-index={index}
                value={options.markers === "number" ? at + 1 : undefined}
                className="zt:py-(--list-spacing)"
                data-query-row={row.indexedKey}
              >
                {options.indentProperties ? (
                  <>
                    <span>{first}</span>
                    {rest.length > 0 && (
                      <span
                        className="zt:block zt:pl-(--list-indent) zt:text-muted-foreground"
                        data-query-row-lines=""
                      >
                        {rest.map((content, line) => (
                          <span key={line} className="zt:block">
                            {content}
                          </span>
                        ))}
                      </span>
                    )}
                  </>
                ) : (
                  filled.map((content, part) => (
                    <Fragment key={part}>
                      {part > 0 && (
                        <span className="zt:text-muted-foreground">
                          {options.separator}
                        </span>
                      )}
                      {content}
                    </Fragment>
                  ))
                )}
              </li>
            </Fragment>
          );
        })}
        {rows.after > 0 && (
          <ListSpacer height={rows.after} ghost={LIST_GHOST} />
        )}
      </List>
    </div>
  );
}
