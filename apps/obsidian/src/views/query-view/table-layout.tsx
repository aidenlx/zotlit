import { Keymap } from "obsidian";
// The Table layout: the Items of a view as rows, like Zotero's item list, with
// the visible properties as columns, the Literature Note Property among them. An Item
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
import type { CSSProperties, ReactNode } from "react";
import { useStore } from "zustand";

import { isPageNumber, itemSelectUri, parseIndexedKey } from "@zotlit/db";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";
import type {
  QueryViewRequest,
  QueryViewRow,
  QueryViewValue,
} from "@/services/item-query/query-view";
import type { QueryService } from "@/services/item-query/service";
import { useAnnotStore } from "@/views/annot-view/store";

import type { QueryLayout } from "./layouts";
import type { ColumnSizes } from "./query-file";
import { CellContent } from "./record-rows";
import { NO_RESULTS } from "./results";
import { TableHeader, sizedMark } from "./table-header";
import type { LiteratureNotes } from "./table-notes";
import { zoteroReaderUri } from "./table-readers";
import type { ReaderTarget, TableReaders } from "./table-readers";
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
  /**
   * The text of one row, under the row it expands from. An Attachment or
   * Annotation row puts its text in a `link` that opens it in its reader.
   */
  render(record: TableRecord, row: ChildRowContext): ReactNode;
}

/** What one child row renders with beside its own values. */
export interface ChildRowContext {
  readonly parent: TableRecord;
  /** The text `children` as a link that opens `target` in its reader. */
  readonly link: (target: ReaderTarget, children: ReactNode) => ReactNode;
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
    render: ({ key, values }, { link }) =>
      link(
        { kind: "attachment", attachmentKey: key },
        text(values.title) || key,
      ),
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
    render: ({ key, values }) => (
      <ZoteroNoteLink noteKey={key}>{text(values.title) || key}</ZoteroNoteLink>
    ),
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
        "pageIndex",
        ...markers("annotation"),
      ],
      sort: [{ field: "sortIndex", direction: "asc" }],
      limit: null,
    })),
    render: ({ key, values }, { parent, link }) => (
      <>
        <span
          className="zt:inline-block zt:size-2.5 zt:shrink-0 zt:rounded-full zt:bg-(--zt-annot-color)"
          style={
            {
              "--zt-annot-color": text(values.color) || undefined,
            } as CSSProperties
          }
        />
        {link(
          {
            kind: "annotation",
            attachmentKey: parent.key,
            annotationKey: key,
            pageIndex:
              typeof values.pageIndex === "number" ? values.pageIndex : null,
            pageLabel: text(values.pageLabel) || null,
          },
          // The page stays in the link, so an Annotation with no text, such
          // as an image, still has a link to open it by.
          <>
            <span className="zt:truncate">
              {text(values.text) || text(values.comment)}
            </span>
            {text(values.pageLabel) !== "" && (
              <span className="zt:shrink-0 zt:text-muted-foreground">
                {isPageNumber(text(values.pageLabel))
                  ? m.query_view_table_page({ page: text(values.pageLabel) })
                  : text(values.pageLabel)}
              </span>
            )}
          </>,
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

export type ChildState =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly rows: readonly TableRecord[] }
  | { readonly phase: "failed" };

export const id = (record: Pick<TableRecord, "kind" | "key">) =>
  `${record.kind}:${record.key}`;

/** The expanded rows and the rows under them, read when a row expands. */
export function useChildren(query: Pick<QueryService, "run">) {
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

export function Expander({
  record,
  open,
  onToggle,
}: {
  record: TableRecord;
  open: boolean;
  onToggle: () => void;
}) {
  // The chevron takes the icon button's own padding, and a row with nothing
  // under it holds a hidden one, so every row's text starts at one edge.
  const chevron = (
    <Icon
      name={open ? "chevron-down" : "chevron-right"}
      size="var(--icon-xs)"
      strokeWidth="var(--icon-xs-stroke-width)"
    />
  );
  if (!expandable(record))
    return (
      <span className="clickable-icon zt:invisible zt:shrink-0">{chevron}</span>
    );
  return (
    <button
      type="button"
      className="clickable-icon zt:shrink-0"
      aria-expanded={open}
      aria-label={
        open ? m.query_view_table_collapse() : m.query_view_table_expand()
      }
      data-query-expand={id(record)}
      onClick={onToggle}
    >
      {chevron}
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
  // A text button in the style of an icon button, so it fits the row's
  // height as a link does.
  return (
    <button
      type="button"
      className="clickable-icon zt:gap-1"
      disabled={creating}
      data-query-create-note={itemKey}
      onClick={() => {
        setCreating(true);
        void notes.create(itemKey).finally(() => setCreating(false));
      }}
    >
      <Icon name="file-plus" size="var(--icon-xs)" />
      {m.query_view_table_create_note()}
    </button>
  );
}

/**
 * A link that shows a Child Note in Zotero, which holds it: Obsidian has no
 * view of a Zotero note. The system starts Zotero from the link where it is
 * closed.
 */
function ZoteroNoteLink({
  noteKey,
  children,
}: {
  noteKey: string;
  children: ReactNode;
}) {
  const parsed = parseIndexedKey(noteKey);
  if (!parsed) return children;
  const uri = itemSelectUri(parsed.key, parsed.groupID);
  return (
    <a
      className="external-link zt:truncate zt:bg-none zt:pe-0"
      href={uri}
      data-query-open="note"
      onClick={(event) => {
        event.preventDefault();
        window.open(uri);
      }}
    >
      {children}
    </a>
  );
}

/**
 * A link that opens an Attachment or Annotation in its reader, and takes a
 * click as an Obsidian link does: a Cmd/Ctrl press or a middle click opens
 * a new tab, and Cmd/Ctrl+Alt a split. Its address is the Zotero link of the
 * target, which a drag carries out.
 */
export function ReaderLink({
  readers,
  target,
  children,
}: {
  readers: TableReaders;
  target: ReaderTarget;
  children: ReactNode;
}) {
  const open = (event: MouseEvent) => {
    event.preventDefault();
    // Obsidian's own pane for a link click: a middle click or a Cmd/Ctrl
    // press opens a new tab.
    void readers.open(target, Keymap.isModEvent(event));
  };
  return (
    <a
      className="internal-link zt:flex zt:min-w-0 zt:items-center zt:gap-1.5"
      href={zoteroReaderUri(target) ?? undefined}
      data-query-open={target.kind}
      onClick={(event) => open(event.nativeEvent)}
      onAuxClick={(event) => {
        if (event.button === 1) open(event.nativeEvent);
      }}
    >
      {children}
    </a>
  );
}

/** The inset of a row `depth` levels under its Item, for `zt:ps-(--zt-indent)`. */
const indent = (depth: number) =>
  ({ "--zt-indent": `calc(${depth - 1} * var(--size-4-5))` }) as CSSProperties;

/**
 * A cell's height, padding and row line: the row height of a Bases table,
 * and Obsidian's table border, so a theme that restyles tables restyles it.
 */
const CELL =
  "zt:h-7.5 zt:border-b-(length:--border-width) zt:border-(--table-border-color) zt:px-2 zt:py-1";
/** The narrow first column that holds a row's expand button. */
const GUTTER = cn(CELL, "zt:w-0 zt:py-0 zt:ps-1 zt:pe-0");
/**
 * A cell of a column the researcher resized, marked `data-sized`: it takes
 * no room of its own, so the header's width holds the column, and what does
 * not fit is clipped, as in a Bases table. Text still wraps, so only a word
 * longer than the column is cut.
 */
const CLIP =
  "zt:data-sized:max-w-0 zt:data-sized:overflow-hidden zt:data-sized:text-ellipsis";
/**
 * The first column of properties. Text wraps in every column, so a long
 * title stays readable in full; the first column keeps a width a title
 * reads well in, from its header cell, where a width the researcher sets
 * replaces it, and the others stop at the width of a Bases column.
 */
const FIRST = cn("zt:ps-1", CLIP);
const FIRST_HEADER = cn(FIRST, "zt:min-w-48");
/** A column after the first: a line parts it from the one before it. */
const LATER = cn("zt:max-w-75 zt:border-s-(length:--border-width)", CLIP);
const ROW = "zt:hover:bg-(--table-row-background-hover)";
/** A header cell, which stays at the top as the rows scroll under it. */
const HEADER =
  "zt:sticky zt:top-0 zt:z-(--layer-cover) zt:bg-background zt:py-0 zt:font-(--font-weight) zt:whitespace-nowrap zt:text-muted-foreground zt:in-[.mod-sidedock]:bg-(--background-secondary) zt:in-[.callout]:bg-transparent";

/**
 * The columns a child row's one cell spans beside the gutter: every column
 * of properties, and one where the view shows none, so the row still has
 * room for its text.
 */
const childSpan = (columns: number) => Math.max(columns, 1);

/** The rows under one expanded row, and the rows under those that are expanded. */
function ChildRows({
  parent,
  depth,
  columns,
  expanded,
  toggle,
  readers,
}: {
  parent: TableRecord;
  depth: number;
  columns: number;
  expanded: ReadonlyMap<string, ChildState>;
  toggle: (record: TableRecord) => void;
  readers: TableReaders;
}) {
  const state = expanded.get(id(parent));
  if (!state) return null;
  if (state.phase !== "ready")
    return (
      <tr data-query-table-status={state.phase}>
        <td className={GUTTER} />
        <td
          colSpan={childSpan(columns)}
          style={indent(depth)}
          className={cn(CELL, "zt:ps-(--zt-indent) zt:text-(--text-muted)")}
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
            parent={parent}
            record={record}
            source={source}
            depth={depth}
            columns={columns}
            expanded={expanded}
            toggle={toggle}
            readers={readers}
          />
        );
      })}
    </>
  );
}

function ChildRow({
  parent,
  record,
  source,
  depth,
  columns,
  expanded,
  toggle,
  readers,
}: {
  parent: TableRecord;
  record: TableRecord;
  source: TableChildSource;
  depth: number;
  columns: number;
  expanded: ReadonlyMap<string, ChildState>;
  toggle: (record: TableRecord) => void;
  readers: TableReaders;
}) {
  const link: ChildRowContext["link"] = (target, children) => (
    <ReaderLink readers={readers} target={target}>
      {children}
    </ReaderLink>
  );
  return (
    <>
      <tr
        className={ROW}
        data-query-table-row={record.kind}
        data-query-key={record.key}
      >
        <td className={GUTTER} />
        <td colSpan={childSpan(columns)} className={cn(CELL, "zt:ps-1")}>
          <span
            className="zt:flex zt:min-w-0 zt:items-center zt:gap-1.5 zt:ps-(--zt-indent)"
            style={indent(depth)}
          >
            <Expander
              record={record}
              open={expanded.has(id(record))}
              onToggle={() => toggle(record)}
            />
            <Icon
              name={source.icon}
              size="var(--icon-xs)"
              strokeWidth="var(--icon-xs-stroke-width)"
              className="zt:shrink-0"
            />
            {source.render(record, { parent, link })}
          </span>
        </td>
      </tr>
      <ChildRows
        parent={record}
        depth={depth + 1}
        columns={columns}
        expanded={expanded}
        toggle={toggle}
        readers={readers}
      />
    </>
  );
}

/** The view's rows as a table of Items. */
export function TableLayout({ view }: { view: QueryView }) {
  const rows = useStore(view.state, (s) => (s.results ?? NO_RESULTS).records);
  const search = useAnnotStore((s) => s.filterQuery)
    .trim()
    .toLowerCase();
  const { query, literatureNotes, readers } = view.tableDeps;
  const { children: expanded, toggle } = useChildren(query);
  const properties = useViewProperties(view);
  const dataset = useStore(view.state, (s) => s.view?.from ?? "annotations");
  const columns = useMemo(() => properties?.visible ?? [], [properties]);
  const scroller = useRef<HTMLDivElement>(null);
  const sizes = useStore(view.state, (s) => s.view?.columnSize);
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
    <div
      ref={scroller}
      className="zt:relative zt:min-h-0 zt:flex-1 zt:overflow-auto"
    >
      <table
        className="zt:min-w-full zt:border-separate zt:border-spacing-0 zt:text-(length:--font-smaller)"
        data-query-table=""
      >
        {properties && (
          <TableHeader
            view={view}
            properties={properties}
            dataset={dataset}
            scroller={scroller}
            sizes={sizes}
            classes={{
              gutter: cn(GUTTER, HEADER),
              cell: cn(CELL, HEADER),
              first: FIRST_HEADER,
              later: LATER,
            }}
          />
        )}
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
                    colSpan={childSpan(columns.length) + 1}
                    className={cn(
                      CELL,
                      "zt:bg-card zt:text-start zt:font-(--font-semibold)",
                    )}
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
                sizes={sizes}
                notes={literatureNotes}
                expanded={expanded}
                toggle={toggle}
                readers={readers}
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
  sizes,
  notes,
  expanded,
  toggle,
  readers,
}: {
  heading: ReactNode;
  record: TableRecord;
  columns: readonly PropertyEntry[];
  /** The widths the researcher set, by property path. */
  sizes: ColumnSizes | undefined;
  notes: LiteratureNotes;
  expanded: ReadonlyMap<string, ChildState>;
  toggle: (record: TableRecord) => void;
  readers: TableReaders;
}) {
  return (
    <>
      {heading}
      <tr
        className={ROW}
        data-query-table-row="item"
        data-query-key={record.key}
      >
        <td className={GUTTER}>
          <Expander
            record={record}
            open={expanded.has(id(record))}
            onToggle={() => toggle(record)}
          />
        </td>
        {columns.map(({ path, kind }, at) => {
          const note = kind === "literatureNote";
          return (
            <td
              key={path}
              className={cn(CELL, at === 0 ? FIRST : LATER, note && "zt:py-0")}
              data-sized={sizedMark(sizes, path)}
            >
              {note ? (
                <NoteCell notes={notes} itemKey={record.key} />
              ) : (
                <CellContent
                  value={record.values[path]}
                  text={cellText(path, record.values[path])}
                />
              )}
            </td>
          );
        })}
      </tr>
      <ChildRows
        parent={record}
        depth={1}
        columns={columns.length}
        expanded={expanded}
        toggle={toggle}
        readers={readers}
      />
    </>
  );
}
