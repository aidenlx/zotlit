// The Table layout: the Items of a view as rows, like Zotero's item list, with
// the visible properties as columns and a "Literature note" column. An Item
// row expands into its Attachments and Child Notes, and an Attachment row
// into its Annotations. Each kind of child row comes from one Table Child
// Source, so a new kind joins the list without another branch.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { useStore } from "zustand";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { cn, tooltipAttrs } from "@/lib/utils";
import type {
  QueryViewRequest,
  QueryViewRow,
  QueryViewValue,
} from "@/services/item-query/query-view";
import type { QueryService } from "@/services/item-query/service";
import { useAnnotStore } from "@/views/annot-view/store";

import type { QueryLayout } from "./layouts";
import { CellContent } from "./record-rows";
import type { LiteratureNotes } from "./table-notes";
import { cellText } from "./value-text";
import type { QueryView } from "./view";
import { useViewProperties } from "./view-properties";
import type { PropertyEntry } from "./view-properties";

export const TABLE_LAYOUT: QueryLayout = {
  type: "table",
  datasets: ["items"],
  name: () => m.query_view_layout_table(),
  icon: "table",
};

/** The kinds of row the Table shows: an Item, and the records under it. */
export type TableRowKind = "item" | "attachment" | "annotation" | "note";

/** One row of the Table: a record of one kind and the values it was read with. */
export interface TableRecord {
  readonly kind: TableRowKind;
  readonly key: string;
  readonly values: QueryViewRow["values"];
}

/** The rows of one kind that a row of another kind expands into. */
export interface TableChildSource {
  /** The kind of row that expands into these rows. */
  readonly parent: TableRowKind;
  readonly kind: TableRowKind;
  readonly icon: string;
  /**
   * The Projection Path of the parent row whose list holds the keys of these
   * rows; a parent with an empty list has no rows of this kind.
   */
  readonly marker: string;
  /**
   * Read the rows under one parent: through a query of a Query Dataset, or
   * from a list the parent row carries.
   */
  load(
    parent: TableRecord,
    query: Pick<QueryService, "run">,
    signal: AbortSignal,
  ): Promise<readonly TableRecord[]>;
  /** The text of one row. */
  render(record: TableRecord): ReactNode;
}

function text(value: QueryViewValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/** A `load` that runs one query for the rows of `kind` under a parent. */
function queried(
  kind: TableRowKind,
  request: (parentKey: string) => QueryViewRequest,
): TableChildSource["load"] {
  return async (parent, query, signal) => {
    const outcome = await query.run(request(parent.key), signal);
    if (outcome.kind !== "result") throw new Error(outcome.kind);
    const rows =
      outcome.result.rows ??
      outcome.result.groups.flatMap((group) => group.rows);
    return rows.map((row) => ({
      kind,
      key: row.indexedKey,
      values: row.values,
    }));
  };
}

export const TABLE_CHILD_SOURCES: readonly TableChildSource[] = [
  {
    parent: "item",
    kind: "attachment",
    icon: "paperclip",
    marker: "attachments[].indexedKey",
    load: queried("attachment", (itemKey) => ({
      from: "attachments",
      filter: `item.indexedKey == ${JSON.stringify(itemKey)}`,
      fields: ["title", ...markers("attachment")],
      limit: null,
    })),
    render: ({ key, values }) => text(values.title) || key,
  },
  {
    parent: "item",
    kind: "note",
    icon: "sticky-note",
    // The Item row's `notes` list holds the key and title of each live Child
    // Note, so these rows need no query of their own.
    marker: "notes",
    load: async (parent) => {
      const notes = parent.values.notes;
      if (!Array.isArray(notes)) return [];
      return notes.flatMap((note: QueryViewValue): TableRecord[] => {
        if (note === null || typeof note !== "object" || Array.isArray(note))
          return [];
        const values = note as QueryViewRow["values"];
        return [{ kind: "note", key: text(values.indexedKey), values }];
      });
    },
    render: ({ key, values }) => text(values.title) || key,
  },
  {
    parent: "attachment",
    kind: "annotation",
    icon: "highlighter",
    marker: "annotations[].indexedKey",
    load: queried("annotation", (attachmentKey) => ({
      from: "annotations",
      filter: `attachment.indexedKey == ${JSON.stringify(attachmentKey)}`,
      fields: [
        "text",
        "comment",
        "color",
        "pageLabel",
        ...markers("annotation"),
      ],
      sort: [{ field: "sortIndex", direction: "asc" }],
      limit: null,
    })),
    render: ({ values }) => (
      <>
        <span
          className="zt:inline-block zt:size-2.5 zt:shrink-0 zt:rounded-full"
          style={{ backgroundColor: text(values.color) || undefined }}
        />
        <span className="zt:truncate">
          {text(values.text) || text(values.comment)}
        </span>
        {text(values.pageLabel) !== "" && (
          <span className="zt:shrink-0 zt:text-(--text-muted)">
            {m.query_view_table_page({ page: text(values.pageLabel) })}
          </span>
        )}
      </>
    ),
  },
];

/** The paths a row of `kind` is read with, so the Table knows what it expands into. */
export function markers(kind: TableRowKind): string[] {
  return TABLE_CHILD_SOURCES.filter((source) => source.parent === kind).map(
    (source) => source.marker,
  );
}

/**
 * The Projection Paths each Item row carries beside the visible properties:
 * the lists that tell what the row expands into.
 */
export const TABLE_FIELDS: readonly string[] = markers("item");

function expandable(record: TableRecord): boolean {
  return TABLE_CHILD_SOURCES.some((source) => {
    if (source.parent !== record.kind) return false;
    const keys = record.values[source.marker];
    return Array.isArray(keys) && keys.length > 0;
  });
}

type ChildState =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly rows: readonly TableRecord[] }
  | { readonly phase: "failed" };

const id = (record: Pick<TableRecord, "kind" | "key">) =>
  `${record.kind}:${record.key}`;

/** The expanded rows and the rows under them, read when a row expands. */
function useChildren(query: Pick<QueryService, "run">) {
  const [children, setChildren] = useState<ReadonlyMap<string, ChildState>>(
    () => new Map(),
  );
  const runs = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const open = runs.current;
    return () => {
      for (const controller of open.values()) controller.abort();
      open.clear();
    };
  }, []);
  const set = (key: string, state: ChildState | null) =>
    setChildren((current) => {
      const next = new Map(current);
      if (state === null) next.delete(key);
      else next.set(key, state);
      return next;
    });
  const toggle = (record: TableRecord) => {
    const key = id(record);
    const running = runs.current.get(key);
    if (children.has(key)) {
      running?.abort();
      runs.current.delete(key);
      set(key, null);
      return;
    }
    const controller = new AbortController();
    runs.current.set(key, controller);
    set(key, { phase: "loading" });
    const sources = TABLE_CHILD_SOURCES.filter(
      (source) => source.parent === record.kind,
    );
    void Promise.all(
      sources.map((source) => source.load(record, query, controller.signal)),
    ).then(
      (lists) => {
        if (controller.signal.aborted) return;
        runs.current.delete(key);
        set(key, { phase: "ready", rows: lists.flat() });
      },
      () => {
        if (controller.signal.aborted) return;
        runs.current.delete(key);
        set(key, { phase: "failed" });
      },
    );
  };
  return { children, toggle };
}

function Expander({
  record,
  open,
  onToggle,
}: {
  record: TableRecord;
  open: boolean;
  onToggle: () => void;
}) {
  if (!expandable(record))
    return <span className="zt:inline-block zt:w-5 zt:shrink-0" />;
  return (
    <button
      type="button"
      className="clickable-icon zt:w-5 zt:shrink-0 zt:p-0.5"
      aria-expanded={open}
      aria-label={
        open ? m.query_view_table_collapse() : m.query_view_table_expand()
      }
      data-query-expand={id(record)}
      onClick={onToggle}
    >
      <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
    </button>
  );
}

function NoteCell({
  notes,
  itemKey,
}: {
  notes: LiteratureNotes;
  itemKey: string;
}) {
  const path = useSyncExternalStore(
    (listener) => notes.on("changed", listener),
    () => notes.find(itemKey)?.path ?? null,
  );
  const [creating, setCreating] = useState(false);
  const note = path === null ? null : notes.find(itemKey);
  if (note)
    return (
      <a
        className="internal-link"
        href={note.path}
        data-query-note={note.path}
        onClick={(event) => {
          event.preventDefault();
          notes.open(note, event.nativeEvent);
        }}
      >
        {note.basename}
      </a>
    );
  return (
    <button
      type="button"
      className="zt:px-2 zt:py-0.5 zt:text-xs"
      disabled={creating}
      data-query-create-note={itemKey}
      onClick={() => {
        setCreating(true);
        void notes.create(itemKey).finally(() => setCreating(false));
      }}
    >
      {m.query_view_table_create_note()}
    </button>
  );
}

/** The inset of a row `depth` levels under its Item. */
const indent = (depth: number) => ({
  paddingInlineStart: `calc(${depth - 1} * 1.25rem)`,
});

/** The rows under one expanded row, and the rows under those that are expanded. */
function ChildRows({
  parent,
  depth,
  columns,
  expanded,
  toggle,
}: {
  parent: TableRecord;
  depth: number;
  columns: number;
  expanded: ReadonlyMap<string, ChildState>;
  toggle: (record: TableRecord) => void;
}) {
  const state = expanded.get(id(parent));
  if (!state) return null;
  if (state.phase !== "ready")
    return (
      <tr data-query-table-status={state.phase}>
        <td />
        <td
          colSpan={columns + 1}
          style={indent(depth)}
          className="zt:px-2 zt:py-0.5 zt:text-(--text-muted)"
        >
          {state.phase === "loading"
            ? m.query_view_table_loading()
            : m.query_view_table_children_failed()}
        </td>
      </tr>
    );
  return (
    <>
      {state.rows.map((record) => {
        const source = TABLE_CHILD_SOURCES.find(
          (candidate) => candidate.kind === record.kind,
        )!;
        return (
          <ChildRow
            key={id(record)}
            record={record}
            source={source}
            depth={depth}
            columns={columns}
            expanded={expanded}
            toggle={toggle}
          />
        );
      })}
    </>
  );
}

function ChildRow({
  record,
  source,
  depth,
  columns,
  expanded,
  toggle,
}: {
  record: TableRecord;
  source: TableChildSource;
  depth: number;
  columns: number;
  expanded: ReadonlyMap<string, ChildState>;
  toggle: (record: TableRecord) => void;
}) {
  return (
    <>
      <tr data-query-table-row={record.kind} data-query-key={record.key}>
        <td />
        <td colSpan={columns + 1} className="zt:px-2 zt:py-0.5">
          <span
            className="zt:flex zt:min-w-0 zt:items-center zt:gap-1.5"
            style={indent(depth)}
          >
            <Expander
              record={record}
              open={expanded.has(id(record))}
              onToggle={() => toggle(record)}
            />
            <Icon name={source.icon} size={14} className="zt:shrink-0" />
            {source.render(record)}
          </span>
        </td>
      </tr>
      <ChildRows
        parent={record}
        depth={depth + 1}
        columns={columns}
        expanded={expanded}
        toggle={toggle}
      />
    </>
  );
}

/** The view's rows as a table of Items. */
export function TableLayout({ view }: { view: QueryView }) {
  const rows = useStore(view.state, (s) => s.records);
  const search = useAnnotStore((s) => s.filterQuery)
    .trim()
    .toLowerCase();
  const { query, literatureNotes } = view.tableDeps;
  const { children: expanded, toggle } = useChildren(query);
  const properties = useViewProperties(view);
  const columns = useMemo(() => properties?.columns ?? [], [properties]);
  const visible = useMemo(
    () =>
      search === ""
        ? rows
        : rows.filter(({ row }) =>
            columns.some(({ path }) =>
              cellText(path, row.values[path]).toLowerCase().includes(search),
            ),
          ),
    [rows, columns, search],
  );
  if (rows.length === 0) return null;
  let group: string | null = null;
  return (
    <div className="zt:min-h-0 zt:flex-1 zt:overflow-auto">
      <table
        className="zt:w-full zt:border-collapse zt:text-sm"
        data-query-table=""
      >
        <thead>
          <tr className="zt:border-b zt:border-(--background-modifier-border) zt:text-left">
            <th className="zt:w-6" />
            {columns.map(({ path, label, issue }) => (
              <th
                key={path}
                className="zt:px-2 zt:py-1 zt:font-medium"
                data-query-column={path}
                data-query-formula-issue={issue ?? undefined}
              >
                {issue === null ? (
                  label
                ) : (
                  <span
                    className="zt:inline-flex zt:items-center zt:gap-1 zt:text-(--text-error)"
                    {...tooltipAttrs(issue)}
                  >
                    <Icon name="alert-triangle" size={14} />
                    {label}
                  </span>
                )}
              </th>
            ))}
            <th className="zt:px-2 zt:py-1 zt:font-medium">
              {m.query_view_table_literature_note()}
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map(({ row, group: placed }, index) => {
            const record: TableRecord = {
              kind: "item",
              key: row.indexedKey,
              values: row.values,
            };
            const heading =
              placed && placed.key !== group ? (
                <tr data-query-group={placed.key}>
                  <th
                    colSpan={columns.length + 2}
                    className="zt:px-2 zt:pt-3 zt:pb-1 zt:text-left zt:font-semibold"
                  >
                    {placed.label}
                  </th>
                </tr>
              ) : null;
            group = placed?.key ?? null;
            return (
              <ItemRow
                key={`${placed?.key ?? ""}\0${row.indexedKey}\0${index}`}
                heading={heading}
                record={record}
                columns={columns}
                notes={literatureNotes}
                expanded={expanded}
                toggle={toggle}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ItemRow({
  heading,
  record,
  columns,
  notes,
  expanded,
  toggle,
}: {
  heading: ReactNode;
  record: TableRecord;
  columns: readonly PropertyEntry[];
  notes: LiteratureNotes;
  expanded: ReadonlyMap<string, ChildState>;
  toggle: (record: TableRecord) => void;
}) {
  return (
    <>
      {heading}
      <tr
        className={cn(
          "zt:border-b zt:border-(--background-modifier-border-hover)",
        )}
        data-query-table-row="item"
        data-query-key={record.key}
      >
        <td className="zt:px-1">
          <Expander
            record={record}
            open={expanded.has(id(record))}
            onToggle={() => toggle(record)}
          />
        </td>
        {columns.map(({ path }) => (
          <td key={path} className="zt:px-2 zt:py-1">
            <CellContent
              value={record.values[path]}
              text={cellText(path, record.values[path])}
            />
          </td>
        ))}
        <td className="zt:px-2 zt:py-1">
          <NoteCell notes={notes} itemKey={record.key} />
        </td>
      </tr>
      <ChildRows
        parent={record}
        depth={1}
        columns={columns.length}
        expanded={expanded}
        toggle={toggle}
      />
    </>
  );
}
