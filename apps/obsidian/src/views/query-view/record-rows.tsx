// The rows of a Query View as the List and Cards layouts draw them: the
// records of any Query Dataset, under their group headings, each shown by
// the text of its visible properties. The toolbar search and a collapsed
// heading act on them as they do on the Annotations layout's cards.
import { useMemo } from "react";
import { useStore } from "zustand";

import { Icon } from "@/components/obsidian/icon";
import type { QueryViewRow } from "@/services/item-query/query-view";
import {
  useAnnotStore,
  useToggleGroupCollapsed,
} from "@/views/annot-view/store";

import { cellText } from "./value-text";
import type { QueryView } from "./view";
import { visibleProperties } from "./visible-properties";

/** One row on screen, and the group it stands in. */
export interface ShownRecord {
  readonly row: QueryViewRow;
  /** The group the row stands in; a row with none stands under no heading. */
  readonly group?: { readonly key: string; readonly label: string };
}

/** One run of rows under one heading, or under none. */
export interface RecordGroup {
  readonly key: string | null;
  readonly label: string | null;
  readonly collapsed: boolean;
  /** The rows of the group, each with the text of its visible properties. */
  readonly rows: readonly { row: QueryViewRow; cells: readonly string[] }[];
}

/**
 * The rows of the shown view, gathered into runs of one group, with the text
 * of each visible property in the view's order. A row the search does not
 * find stays off screen.
 */
export function useRecordGroups(view: QueryView): {
  properties: readonly string[];
  groups: readonly RecordGroup[];
} {
  const shown = useStore(view.state, (s) => s.view);
  const records = useStore(view.state, (s) => s.records);
  const query = useAnnotStore((s) => s.filterQuery)
    .trim()
    .toLowerCase();
  const collapsed = useAnnotStore((s) => s.collapsedGroups);
  return useMemo(() => {
    const properties = shown
      ? visibleProperties(shown, { fallback: true })
      : [];
    const groups: {
      key: string | null;
      label: string | null;
      collapsed: boolean;
      rows: { row: QueryViewRow; cells: string[] }[];
    }[] = [];
    for (const { row, group } of records) {
      const cells = properties.map((property) =>
        cellText(property, row.values[property]),
      );
      if (
        query !== "" &&
        !cells.some((text) => text.toLowerCase().includes(query))
      )
        continue;
      const key = group?.key ?? null;
      let last = groups.at(-1);
      if (!last || last.key !== key) {
        last = {
          key,
          label: group?.label ?? null,
          collapsed: key !== null && collapsed.has(key),
          rows: [],
        };
        groups.push(last);
      }
      last.rows.push({ row, cells });
    }
    return { properties, groups };
  }, [shown, records, query, collapsed]);
}

/**
 * A group's heading. Its button collapses the group's rows and expands them
 * again; the heading's own text names it, so it needs no tooltip.
 */
export function RecordGroupHeading({ group }: { group: RecordGroup }) {
  const toggle = useToggleGroupCollapsed();
  if (group.key === null) return null;
  const key = group.key;
  return (
    <div
      data-query-group={key}
      data-collapsed={group.collapsed ? "" : undefined}
      className="zt:mt-2 zt:first:mt-0"
    >
      <button
        type="button"
        aria-expanded={!group.collapsed}
        className="clickable-icon zt:flex zt:min-w-0 zt:items-center zt:gap-1 zt:text-sm zt:font-semibold zt:text-(--text-muted)"
        onClick={() => toggle(key)}
      >
        <Icon
          name={group.collapsed ? "chevron-right" : "chevron-down"}
          size={14}
        />
        <span className="zt:truncate">{group.label}</span>
      </button>
    </div>
  );
}
