// The Papers layout: the Items of a view as a reading list, two lines per
// Item after the icon of its Item type. The title, cut to one line; then the creators, the year and the
// Venue, ending with the reason the host gives for the row. The row ends
// with the kind of the Item's main Attachment and a mark for its Literature
// Note, and expands into the rows the Table expands into. It reads no
// Annotation: the Reading Card and the Reading State facets carry the rest
// of the Reading State.
//
// @see apps/obsidian/docs/adr/0075-the-papers-layout-is-a-query-view-layout-the-library-view-offers-with-the-table.md
import { Fragment, useMemo, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";

import { resolveVenue } from "@zotlit/db";
import { useUniqueId } from "@zotlit/ui";

import { FirstLine, Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { itemTypeIcon } from "@/lib/item-type-icon";
import { cn } from "@/lib/utils";
import type { TargetOpenGesture } from "@/services/attachment-open/actions";
import type { OpenTarget } from "@/services/attachment-open/open-target";
import type { QueryViewValue } from "@/services/item-query/query-view";

import { useItemRow } from "./item-rows";
import type { ItemRowGestures } from "./item-rows";
import { useItemsWindow } from "./items-window";
import type { WindowEntry } from "./items-window";
import type { QueryLayout } from "./layouts";
import { useQueryTask } from "./model";
import {
  HEADING_ESTIMATE,
  RecordGroupHeading,
  groupEntries,
  useRecordGroups,
} from "./record-rows";
import {
  Expander,
  ExpanderSpace,
  LOADING_TEXT,
  ReaderLink,
  TABLE_FIELDS,
  childSource,
  id,
  useChildren,
} from "./table-layout";
import type { ChildState, TableRecord } from "./table-layout";
import type { LiteratureNotes } from "./table-notes";
import type { QueryView } from "./view";
import { ListSpacer, placeholderRow } from "./virtual-spacers";

export const PAPERS_LAYOUT: QueryLayout = {
  type: "papers",
  datasets: ["items"],
  name: () => m.query_view_layout_papers(),
  icon: "library",
};

/**
 * The paths each Papers row reads beside the visible properties: its icon,
 * its lines, its Attachment kinds and what it expands into.
 */
export const PAPERS_FIELDS: readonly string[] = [
  "itemType",
  "title",
  "creators",
  "date",
  "publicationTitle",
  "publisher",
  // The rest of the Library View's Reading Card header, which it shows from
  // the row while it reads the Item.
  "volume",
  "issue",
  "pages",
  "DOI",
  "citationKey",
  "attachments[].fileType",
  ...TABLE_FIELDS,
];

/** A row-end slot, one extra-small icon wide, kept where it holds no mark. */
const MARK_SLOT =
  "zt:flex zt:w-(--icon-xs) zt:shrink-0 zt:items-center zt:justify-center";

/** The most creators the second line names before "et al.". */
const SHOWN_CREATORS = 3;

/** The Attachment kinds a row's end mark shows, the first one an Item has winning. */
const ATTACHMENT_KINDS = [
  {
    type: "pdf",
    icon: "file-text",
    label: () => m.query_view_papers_attachment_pdf(),
  },
  {
    type: "epub",
    icon: "book-open",
    label: () => m.query_view_papers_attachment_epub(),
  },
  {
    type: "web",
    icon: "globe",
    label: () => m.query_view_papers_attachment_web(),
  },
] as const;

function text(value: QueryViewValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function list(value: QueryViewValue | undefined): readonly QueryViewValue[] {
  return Array.isArray(value) ? value : [];
}

function record(
  value: QueryViewValue | undefined,
): Readonly<Record<string, QueryViewValue>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, QueryViewValue>>)
    : null;
}

/**
 * The names of the Item's first creators, by family name: the creators of
 * the role the first one has, as Zotero's Creator column names the authors
 * and not the editors.
 */
function creatorsText(value: QueryViewValue | undefined): string {
  const creators = list(value).flatMap((entry) => {
    const creator = record(entry);
    return creator ? [creator] : [];
  });
  const role = creators[0]?.role;
  const names = creators
    .filter((creator) => creator.role === role)
    .map((creator) => text(creator.literal) || text(creator.family))
    .filter((name) => name !== "");
  const shown = names.slice(0, SHOWN_CREATORS).join(", ");
  return names.length > SHOWN_CREATORS
    ? m.query_view_papers_more_creators({ names: shown })
    : shown;
}

function yearText(value: QueryViewValue | undefined): string {
  const year = record(value)?.year;
  return typeof year === "number" ? String(year) : "";
}

/** The second line: the creators, the year and the Venue. */
export function metaText(values: TableRecord["values"]): string {
  const venue = resolveVenue({
    publicationTitle: text(values.publicationTitle) || null,
    publisher: text(values.publisher) || null,
    volume: null,
    issue: null,
    pages: null,
  });
  return [creatorsText(values.creators), yearText(values.date), venue ?? ""]
    .filter((part) => part !== "")
    .join(" · ");
}

function mainAttachmentKind(values: TableRecord["values"]) {
  const types = list(values["attachments[].fileType"]);
  return ATTACHMENT_KINDS.find((kind) => types.includes(kind.type)) ?? null;
}

/**
 * Whether the Item has a PDF to open: the one rule for every surface that
 * offers Open PDF, read from the Attachment kinds a Papers row reads.
 */
export function holdsPdf(values: Readonly<Record<string, QueryViewValue>>) {
  return list(values["attachments[].fileType"]).includes("pdf");
}

/** The path of the Item's Literature Note, as the Note Index has it now. */
function useNotePath(notes: LiteratureNotes, itemKey: string): string | null {
  return useSyncExternalStore(
    (listener) => notes.on("changed", listener),
    () => notes.find(itemKey)?.path ?? null,
  );
}

/** The height of a Papers entry of each kind, before it is measured. */
const ESTIMATES = { heading: HEADING_ESTIMATE, row: 46, line: 32 };

/**
 * The outline of a row not yet drawn, where a row draws its parts: past the
 * room of the expand button, the type's icon on the title's line, a bar for
 * the title and a shorter one for the second line, and the line under the
 * row. The places are those of a row at Obsidian's interface font.
 */
const GHOST = cn(
  "zt:bg-repeat-y zt:[--zt-ghost:var(--background-modifier-hover)]",
  "zt:bg-[image:linear-gradient(to_bottom,transparent_6px,var(--zt-ghost)_0_22px,transparent_0),linear-gradient(to_bottom,transparent_10px,var(--zt-ghost)_0_19px,transparent_0),linear-gradient(to_bottom,transparent_27px,var(--zt-ghost)_0_35px,transparent_0),linear-gradient(to_bottom,transparent_calc(100%-var(--border-width)),var(--background-modifier-border)_0)]",
  "zt:bg-size-[16px_var(--zt-virtual-row),min(55%,24rem)_var(--zt-virtual-row),min(35%,16rem)_var(--zt-virtual-row),100%_var(--zt-virtual-row)]",
  "zt:bg-position-[36px_0,58px_0,58px_0,0_0]",
);

/** The rows of the shown view as a reading list, under their group headings. */
export function PapersLayout({ view }: { view: QueryView }) {
  const { groups } = useRecordGroups(view);
  const { literatureNotes, readers } = view.tableDeps;
  const { children: expanded, toggle } = useChildren(view);
  const gestures = view.rows;
  const entries = useMemo(() => groupEntries(groups), [groups]);
  const rows = useItemsWindow(
    view,
    useMemo(
      () =>
        entries.map((entry): WindowEntry => {
          if (entry.kind === "heading")
            return { key: entry.key, kind: "heading", item: null };
          const { row } = entry.record;
          return {
            key: entry.key,
            // A row with no second line is one line high.
            kind:
              metaText(row.values) !== "" || view.reason(row) !== null
                ? "row"
                : "line",
            item: row.indexedKey,
            own: expanded.has(id({ kind: "item", key: row.indexedKey })),
          };
        }),
      [entries, expanded, view],
    ),
    { estimates: ESTIMATES, fallback: ESTIMATES.row },
  );
  return (
    <div
      ref={rows.box}
      className="zt:min-h-0 zt:flex-1 zt:overflow-auto zt:px-1 zt:pb-11 zt:[overflow-anchor:none] zt:not-in-[.zt-query-note]:scroll-gutter zt:in-[.zt-query-note]:pb-2"
      data-query-layout="papers"
      style={placeholderRow(rows.learned.get("row") ?? ESTIMATES.row)}
    >
      <ul
        ref={rows.list}
        className="zt:m-0 zt:list-none zt:p-0"
        onFocus={rows.onFocus}
      >
        {rows.entries.map(({ index, before }) => {
          const entry = entries[index]!;
          return (
            <Fragment key={entry.key}>
              {before > 0 && <ListSpacer height={before} ghost={GHOST} />}
              {entry.kind === "heading" ? (
                // The heading drops its own top margin as the first child
                // here; the entry keeps it after a row.
                <li
                  ref={rows.measure}
                  data-index={index}
                  className={cn(index > 0 && "zt:pt-2")}
                >
                  <RecordGroupHeading group={entry.group} />
                </li>
              ) : (
                <PaperRow
                  index={index}
                  measure={rows.measure}
                  item={{
                    kind: "item",
                    key: entry.record.row.indexedKey,
                    values: entry.record.row.values,
                  }}
                  reason={view.reason(entry.record.row)}
                  notes={literatureNotes}
                  readers={readers}
                  expanded={expanded}
                  toggle={toggle}
                  gestures={gestures}
                />
              )}
            </Fragment>
          );
        })}
        {rows.after > 0 && <ListSpacer height={rows.after} ghost={GHOST} />}
      </ul>
    </div>
  );
}

interface Expansion {
  readonly expanded: ReadonlyMap<string, ChildState>;
  readonly toggle: (record: TableRecord) => void;
  readonly readers: TargetOpenGesture;
}

function PaperRow({
  index,
  measure,
  item,
  notes,
  readers,
  expanded,
  toggle,
  reason,
  gestures,
}: Expansion & {
  /** The row's place among the list's entries. */
  index: number;
  measure: (el: Element | null) => void;
  item: TableRecord;
  notes: LiteratureNotes;
  /** Why the row is in the list, last on its second line. */
  reason: string | null;
  gestures: ItemRowGestures | undefined;
}) {
  const row = useItemRow(gestures, item.key);
  const open = expanded.has(id(item));
  const { values } = item;
  const note = useNotePath(notes, item.key);
  const titleId = useUniqueId();
  const meta = [metaText(values), reason ?? ""]
    .filter((part) => part !== "")
    .join(" · ");
  const kind = mainAttachmentKind(values);
  const typeIcon = itemTypeIcon(text(values.itemType) || null);
  return (
    <li
      ref={measure}
      data-index={index}
      className="zt:border-b-(length:--border-width) zt:border-border"
      data-query-papers-row={item.key}
    >
      {/* A row the host lets take focus is a group named by its title: an
          `aria-label` would show a tooltip. */}
      <div
        {...row}
        {...(gestures && { role: "group", "aria-labelledby": titleId })}
        className="zt:flex zt:items-start zt:gap-1.5 zt:rounded-sm zt:px-1 zt:py-1.5 zt:outline-hidden zt:hover:bg-(--background-modifier-hover) zt:focus-visible:shadow-[inset_0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:data-revealed:animate-row-flash zt:data-selected:bg-(--nav-item-background-selected)"
      >
        {/* The chevron, the type and the marks at the end sit on the
            title's line, not the row's top. */}
        <FirstLine className="zt:text-sm">
          <Expander
            record={item}
            open={open}
            onToggle={() => toggle(item)}
            holdsMore={note !== null}
          />
        </FirstLine>
        <FirstLine className="zt:text-sm">
          {/* Decoration: the title names the row, so the type is not read out. */}
          <Icon
            name={typeIcon}
            size="s"
            className="zt:shrink-0 zt:text-(--icon-color)"
            data-query-papers-icon={typeIcon}
          />
        </FirstLine>
        <div className="zt:min-w-0 zt:flex-1">
          {/* An Item with no title keeps the title's line, so the row's
              height follows its second line alone. */}
          <div
            id={titleId}
            className="zt:min-h-lh zt:truncate zt:text-sm zt:font-(--font-medium) zt:text-foreground"
            data-query-papers-title=""
          >
            {text(values.title)}
          </div>
          {meta !== "" && (
            <div
              className="zt:truncate zt:text-xs zt:text-muted-foreground"
              data-query-papers-meta=""
            >
              {meta}
            </div>
          )}
        </div>
        {/* Two fixed slots, the note's then the Attachment's, each holding
            its place where the row has no mark, so every mark of a kind
            lines up in one column. The title, cut short, stops 8 px before
            them. */}
        <FirstLine className="zt:ms-(--size-2-1) zt:gap-1 zt:text-sm zt:text-(--icon-color)">
          <span className={MARK_SLOT} data-query-papers-slot="note">
            {note !== null && (
              <span className="zt:flex" data-query-papers-note="">
                <span className="zt:sr-only">
                  {m.query_view_papers_note_marker()}
                </span>
                <Icon name="notebook-pen" size="xs" />
              </span>
            )}
          </span>
          <span className={MARK_SLOT} data-query-papers-slot="attachment">
            {kind && (
              <span
                className="zt:flex"
                data-query-papers-attachment={kind.type}
              >
                <span className="zt:sr-only">{kind.label()}</span>
                <Icon name={kind.icon} size="xs" />
              </span>
            )}
          </span>
        </FirstLine>
      </div>
      {open && (
        <ul className="zt:m-0 zt:list-none zt:p-0 zt:pb-1">
          <ChildRows
            parent={item}
            depth={1}
            expanded={expanded}
            toggle={toggle}
            readers={readers}
          />
          {note !== null && <LiteratureNoteRow notes={notes} item={item} />}
        </ul>
      )}
    </li>
  );
}

/** The inset of a row `depth` levels under its Item, past the Item's chevron. */
const indent = (depth: number) =>
  ({
    "--zt-indent": `calc(${depth} * var(--size-4-5))`,
  }) as CSSProperties;

const CHILD_ROW =
  "zt:flex zt:min-w-0 zt:items-center zt:gap-1.5 zt:rounded-sm zt:py-0.5 zt:ps-(--zt-indent) zt:pe-1 zt:text-xs zt:hover:bg-(--background-modifier-hover)";

/** The rows under one expanded row, and the rows under those that are expanded. */
function ChildRows({
  parent,
  depth,
  expanded,
  toggle,
  readers,
}: Expansion & { parent: TableRecord; depth: number }) {
  const state = expanded.get(id(parent));
  if (!state) return null;
  // A row being read takes the room of the row it becomes, so the rows
  // under it move once, as it opens.
  if (state.phase === "loading")
    return state.pending.map((child, at) => (
      <li
        key={id(child)}
        className={cn(CHILD_ROW, "zt:text-muted-foreground")}
        style={indent(depth)}
        data-query-table-status="loading"
      >
        <ExpanderSpace />
        <Icon
          name={childSource(child.kind).icon}
          size="xs"
          className="zt:shrink-0 zt:text-(--icon-color)"
        />
        {at === 0 && (
          <span className={LOADING_TEXT} data-query-loading="">
            {m.query_view_table_loading()}
          </span>
        )}
      </li>
    ));
  if (state.phase === "failed")
    return (
      <li
        className={cn(CHILD_ROW, "zt:text-muted-foreground")}
        style={indent(depth)}
        data-query-table-status={state.phase}
      >
        {m.query_view_table_children_failed()}
      </li>
    );
  const link = (target: OpenTarget, children: ReactNode) => (
    <ReaderLink readers={readers} target={target}>
      {children}
    </ReaderLink>
  );
  return state.rows.map((record) => {
    const source = childSource(record.kind);
    return (
      <Fragment key={id(record)}>
        <li
          className={CHILD_ROW}
          style={indent(depth)}
          data-query-papers-child={record.kind}
          data-query-key={record.key}
        >
          <Expander
            record={record}
            open={expanded.has(id(record))}
            onToggle={() => toggle(record)}
          />
          <Icon
            name={source.icon}
            size="xs"
            className="zt:shrink-0 zt:text-(--icon-color)"
          />
          {source.render(record, { parent, link })}
        </li>
        <ChildRows
          parent={record}
          depth={depth + 1}
          expanded={expanded}
          toggle={toggle}
          readers={readers}
        />
      </Fragment>
    );
  });
}

/** The Item's Literature Note, last under it, which opens as a link does. */
function LiteratureNoteRow({
  notes,
  item,
}: {
  notes: LiteratureNotes;
  item: TableRecord;
}) {
  const run = useQueryTask();
  const note = notes.find(item.key);
  if (!note) return null;
  return (
    <li
      className={CHILD_ROW}
      style={indent(1)}
      data-query-papers-child="literature-note"
    >
      {/* A row with nothing under it holds the place of a chevron, so the
          icon lines up with the rows above. */}
      <ExpanderSpace />
      <Icon
        name="notebook-pen"
        size="xs"
        className="zt:shrink-0 zt:text-(--icon-color)"
      />
      <a
        className="internal-link zt:truncate"
        href={note.path}
        data-query-note={note.path}
        onClick={(event) => {
          event.preventDefault();
          run(notes.open(note, event.nativeEvent));
        }}
      >
        {note.basename}
      </a>
    </li>
  );
}
