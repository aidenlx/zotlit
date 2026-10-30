// The rows of a Query View as the List and Cards layouts draw them: the
// records of any Query Dataset, under their group headings, each shown by
// the text of its visible properties. The toolbar search and a collapsed
// heading act on them as they do on the Annotations layout's cards.
import { Fragment, useMemo } from "react";

import { errorCell, valueText } from "@zotlit/item-query";

import { Icon } from "@/components/obsidian/icon";
import { tooltipAttrs } from "@/lib/utils";
import type {
  QueryViewRow,
  QueryViewValue,
} from "@/services/item-query/query-view";
import {
  useAnnotStore,
  useToggleGroupCollapsed,
} from "@/views/annot-view/store";

import { useQueryViewState } from "./model";
import { vaultName } from "./query-file";
import { NO_RESULTS } from "./results";
import type { LiteratureNotes, VaultHost, VaultValue } from "./table-notes";
import { cellText } from "./value-text";
import { VaultCellContent, useVaultVersion, vaultText } from "./vault-cell";
import type { QueryView } from "./view";
import { useViewProperties } from "./view-properties";
import type { PropertyEntry } from "./view-properties";
import "./record-rows.css";

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
  readonly rows: readonly RecordCells[];
}

/** One row and its visible properties, each as text and, for a vault property, its value. */
export interface RecordCells {
  readonly row: QueryViewRow;
  readonly cells: readonly string[];
  /** The value of each vault property, by its place among the cells; else `null`. */
  readonly vault: readonly (VaultValue | null)[];
}

/**
 * The text of each visible property of `row`, in the view's order, as copy
 * writes it and the toolbar search finds it, and the value of each vault
 * property: of `host` for the Item it names, else of the Item's first
 * Literature Note.
 */
export function recordCells(
  row: QueryViewRow,
  properties: readonly Pick<PropertyEntry, "path">[],
  {
    notes,
    host,
  }: { notes: Pick<LiteratureNotes, "read">; host: VaultHost | null },
): Pick<RecordCells, "cells" | "vault"> {
  const vault = properties.map(({ path }) => {
    const name = vaultName(path);
    return name === null ? null : notes.read(row.indexedKey, name, host);
  });
  const cells = properties.map(({ path }, at) => {
    const value = vault[at];
    return value ? vaultText(value) : cellText(path, row.values[path]);
  });
  return { cells, vault };
}

/** Whether the toolbar search `query`, lower-cased, finds any of `cells`. */
export function searchFinds(cells: readonly string[], query: string): boolean {
  return (
    query === "" || cells.some((text) => text.toLowerCase().includes(query))
  );
}

/**
 * The rows of the shown view, gathered into runs of one group, with the text
 * of each visible property in the view's order. A row the search does not
 * find stays off screen.
 */
export function useRecordGroups(view: QueryView): {
  properties: readonly PropertyEntry[];
  groups: readonly RecordGroup[];
} {
  const columns = useViewProperties(view)?.visible;
  const records = useQueryViewState(
    view,
    (s) => (s.results ?? NO_RESULTS).records,
  );
  const query = useAnnotStore((s) => s.filterQuery)
    .trim()
    .toLowerCase();
  const collapsed = useAnnotStore((s) => s.collapsedGroups);
  const { literatureNotes: notes } = view.tableDeps;
  // The vault properties read again on a change of the notes, with no run.
  const vaultVersion = useVaultVersion(notes);
  return useMemo(() => {
    void vaultVersion;
    const properties = columns ?? [];
    const host = view.vaultHost();
    const groups: {
      key: string | null;
      label: string | null;
      collapsed: boolean;
      rows: RecordCells[];
    }[] = [];
    for (const { row, group } of records) {
      const { cells, vault } = recordCells(row, properties, { notes, host });
      if (!searchFinds(cells, query)) continue;
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
      last.rows.push({ row, cells, vault });
    }
    return { properties, groups };
  }, [columns, records, query, collapsed, notes, view, vaultVersion]);
}

/**
 * A group's heading. Its button collapses the group's rows and expands them
 * again; the heading's own text names it, so it needs no tooltip. It reads
 * as the heading of a Bases group: the value in its size and weight, on the
 * line height of a Bases row, after a chevron in the collapse icon's ink.
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
        className="zt-query-group-toggle zt:flex zt:max-w-full zt:min-w-0 zt:cursor-(--cursor) zt:items-baseline zt:gap-(--size-4-1) zt:rounded-(--clickable-icon-radius) zt:px-(--size-2-2) zt:text-(length:--font-smaller) zt:leading-7.5 zt:font-(--font-semibold) zt:text-(--text-normal) zt:hover:bg-(--background-modifier-hover) zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:focus-visible:outline-none"
        onClick={() => toggle(key)}
      >
        <Icon
          name={group.collapsed ? "chevron-right" : "chevron-down"}
          size="xs"
          className="zt:shrink-0 zt:self-center zt:text-(--collapse-icon-color)"
        />
        <span className="zt:truncate">{group.label}</span>
      </button>
    </div>
  );
}

/** The cell of the property at `at` of one row: a vault cell, or the row's value. */
export function RecordCell({
  record: { row, cells, vault },
  properties,
  at,
}: {
  record: RecordCells;
  properties: readonly PropertyEntry[];
  at: number;
}) {
  const value = vault[at];
  // An empty vault property is blank, as any blank property is.
  if (value)
    return cells[at] === "" && value.note ? null : (
      <VaultCellContent value={value} />
    );
  return (
    <CellContent value={row.values[properties[at]!.path]} text={cells[at]!} />
  );
}

/** Whether `value` is an Error Value, or a list that holds one at any depth. */
function holdsError(value: QueryViewValue | undefined): boolean {
  return (
    errorCell(value) !== null ||
    (Array.isArray(value) && value.some((entry) => holdsError(entry)))
  );
}

/**
 * One cell on screen: its text, or, for an Error Value, a warning icon with
 * the error's message as its tooltip. A list that holds an Error Value shows
 * its elements as `cell` writes them, each Error Value as its icon.
 */
export function CellContent({
  value,
  text,
}: {
  value: QueryViewValue | undefined;
  text: string;
}) {
  const error = errorCell(value);
  if (error !== null)
    return (
      <span
        role="img"
        className="zt:inline-flex zt:items-center zt:align-middle zt:text-(--text-error)"
        data-query-error={error.code}
        {...tooltipAttrs(error.message)}
      >
        <Icon name="alert-triangle" size="xs" />
      </span>
    );
  if (!Array.isArray(value) || !holdsError(value)) return text;
  const shown = value.filter(
    (entry: QueryViewValue) => valueText(entry) !== "",
  );
  return (
    <>
      {shown.map((entry: QueryViewValue, at) => (
        <Fragment key={at}>
          {at > 0 && ", "}
          <CellContent value={entry} text={valueText(entry)} />
        </Fragment>
      ))}
    </>
  );
}
