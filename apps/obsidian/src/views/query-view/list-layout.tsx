// The List layout: one line for each row of any Query Dataset, its visible
// properties in the view's order, as the List layout of Bases draws a note.
// Its options are those of Bases 1.14.4: `markers`, `indentProperties` and
// `separator`.
import { Setting } from "obsidian";
import { Fragment } from "react";
import { useStore } from "zustand";

import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";

import type { QueryLayout } from "./layouts";
import type { QueryFileView } from "./query-file";
import {
  CellContent,
  RecordGroupHeading,
  useRecordGroups,
} from "./record-rows";
import type { QueryView } from "./view";

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
export function addListOptions(
  el: HTMLElement,
  options: ListLayoutOptions,
  {
    set,
    redraw,
  }: {
    set: (key: keyof ListLayoutOptions, value: unknown) => void;
    /** Draw the options again, as one option shows or hides another. */
    redraw: () => void;
  },
): void {
  const labels: Record<ListMarker, () => string> = {
    bullet: m.query_view_list_marker_bullet,
    number: m.query_view_list_marker_number,
    none: m.query_view_list_marker_none,
  };
  new Setting(el)
    .setName(m.query_view_list_markers())
    .addDropdown((dropdown) => {
      for (const marker of LIST_MARKERS)
        dropdown.addOption(marker, labels[marker]());
      dropdown.selectEl.dataset.queryViewOption = "markers";
      dropdown
        .setValue(options.markers)
        .onChange((value) =>
          set(
            "markers",
            value === LIST_LAYOUT_DEFAULTS.markers ? undefined : value,
          ),
        );
    });
  new Setting(el)
    .setName(m.query_view_list_indent_properties())
    .addToggle((toggle) => {
      toggle.toggleEl.dataset.queryViewOption = "indentProperties";
      toggle.setValue(options.indentProperties).onChange((value) => {
        set("indentProperties", value);
        // The separator shows only where the properties share one line.
        redraw();
      });
    });
  if (!options.indentProperties)
    new Setting(el)
      .setName(m.query_view_list_property_separator())
      .addText((text) => {
        text.inputEl.dataset.queryViewOption = "separator";
        text
          .setPlaceholder(LIST_LAYOUT_DEFAULTS.separator)
          .setValue(options.separator)
          .onChange((value) =>
            set("separator", value === "" ? undefined : value),
          );
      });
}

/** The rows of the shown view, one line each, under their group headings. */
export function ListLayout({ view }: { view: QueryView }) {
  const { properties, groups } = useRecordGroups(view);
  const options = listLayoutOptions(useStore(view.state, (s) => s.view));
  // Numbers count the rows of a list; bullets and none mark no order.
  const List = options.markers === "number" ? "ol" : "ul";
  return (
    <div
      className="zt:min-h-0 zt:flex-1 zt:overflow-auto zt:px-3 zt:pt-2 zt:pb-11 zt:in-[.zt-query-note]:pb-2"
      data-query-layout="list"
    >
      {groups.map((group, groupIndex) => (
        <section key={`${groupIndex}\n${group.key ?? ""}`}>
          <RecordGroupHeading group={group} />
          {!group.collapsed && (
            <List
              className={cn(
                "zt:my-0 zt:py-1 zt:text-(length:--bases-table-font-size) zt:marker:text-(--list-marker-color)",
                options.markers === "bullet" &&
                  "zt:list-disc zt:pl-(--list-indent)",
                options.markers === "number" &&
                  "zt:list-decimal zt:pl-(--list-indent)",
                options.markers === "none" && "zt:list-none zt:pl-0",
              )}
              data-query-markers={options.markers}
            >
              {group.rows.map(({ row, cells }, index) => {
                const filled = cells.flatMap((text, at) =>
                  text === ""
                    ? []
                    : [
                        <CellContent
                          key={properties[at]!.path}
                          value={row.values[properties[at]!.path]}
                          text={text}
                        />,
                      ],
                );
                const [first = "", ...rest] = filled;
                return (
                  <li
                    key={`${row.indexedKey}\n${index}`}
                    className="zt:py-(--list-spacing)"
                    data-query-row={row.indexedKey}
                  >
                    {options.indentProperties ? (
                      <>
                        <span>{first}</span>
                        {rest.length > 0 && (
                          <span className="zt:block zt:pl-(--list-indent) zt:text-muted-foreground">
                            {rest.map((content, at) => (
                              <span key={at} className="zt:block">
                                {content}
                              </span>
                            ))}
                          </span>
                        )}
                      </>
                    ) : (
                      filled.map((content, at) => (
                        <Fragment key={at}>
                          {at > 0 && (
                            <span className="zt:text-muted-foreground">
                              {options.separator}
                            </span>
                          )}
                          {content}
                        </Fragment>
                      ))
                    )}
                  </li>
                );
              })}
            </List>
          )}
        </section>
      ))}
    </div>
  );
}
