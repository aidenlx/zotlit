// The List layout: one line for each row of any Query Dataset, its visible
// properties in the view's order, as the List layout of Bases draws a note.
// Its options are those of Bases 1.14.4: `markers`, `indentProperties` and
// `separator`.
import { useMemo, useState } from "react";

import { useUniqueId } from "@zotlit/ui";

import { Chooser } from "@/components/chooser";
import { Dropdown, DropdownItem } from "@/components/obsidian/dropdown";
import { Toggle } from "@/components/obsidian/toggle";
import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";

import { ItemsWindow } from "./items-window";
import type { DrawnEntry, WindowEntry } from "./items-window";
import type { QueryLayout } from "./layouts";
import { drawListRow, useListRowHeights } from "./list-row";
import { useQueryViewState } from "./model";
import type { QueryFileView } from "./query-file";
import {
  HEADING_ESTIMATE,
  RecordGroupHeading,
  groupEntries,
  useRecordGroups,
} from "./record-rows";
import type { QueryView } from "./view";
import { LIST_GHOST } from "./virtual-spacers";

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
  const [box, setBox] = useState<HTMLElement | null>(null);
  const { heights, metrics, read } = useListRowHeights(box, entries, {
    properties,
    options,
  });

  const windowEntries = useMemo(
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
  );
  const draw = (index: number): DrawnEntry => {
    const entry = entries[index]!;
    if (entry.kind === "heading")
      return {
        // The heading stands at the list's start edge, out of the indent
        // the markers take.
        props: {
          className: cn(
            "zt:list-none",
            markers !== "none" && "zt:-ml-(--list-indent)",
            index > 0 && "zt:pt-2",
          ),
        },
        children: <RecordGroupHeading group={entry.group} />,
      };
    return drawListRow(entry.record, entry.at, { properties, options });
  };
  return (
    <ItemsWindow
      view={view}
      entries={windowEntries}
      estimates={ESTIMATES}
      // A row's lines follow the options, the properties it shows, and the
      // width and font it wraps at.
      shape={JSON.stringify([
        [markers, indentProperties, separator],
        properties.map(({ path }) => path),
        metrics && [Math.round(metrics.width), metrics.font],
      ])}
      box={{
        className: "zt:px-3 zt:pt-2 zt:pb-11 zt:in-[.zt-query-note]:pb-2",
        "data-query-layout": "list",
      }}
      boxRef={setBox}
      flow={{
        kind: "list",
        // Numbers count the rows of a list; bullets and none mark no order.
        as: markers === "number" ? "ol" : "ul",
        // A word too long for the line breaks, as `list-heights.ts` lays it
        // out.
        props: {
          className: cn(
            "zt:my-0 zt:py-1 zt:text-(length:--font-smaller) zt:wrap-break-word zt:marker:text-(--list-marker-color)",
            markers === "bullet" && "zt:list-disc zt:pl-(--list-indent)",
            markers === "number" && "zt:list-decimal zt:pl-(--list-indent)",
            markers === "none" && "zt:list-none zt:pl-0",
          ),
          "data-query-markers": markers,
        },
        ghost: LIST_GHOST,
      }}
      draw={draw}
      // Read the drawn rows after each draw of the window.
      drew={read}
    />
  );
}
