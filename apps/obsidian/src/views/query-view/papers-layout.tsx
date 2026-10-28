// The Papers layout: the Items of a view as a reading list, two lines per
// Item after the icon of its Item type. The title, cut to one line; then the creators, the year and the
// Venue, ending with the reason the host gives for the row. The row ends
// with the kind of the Item's main Attachment and a mark for its Literature
// Note, and expands into the rows the Table expands into. It reads no
// Annotation: the Reading Card and the Reading State facets carry the rest
// of the Reading State.
//
// @see apps/obsidian/docs/adr/0075-the-papers-layout-is-a-query-view-layout-the-library-view-offers-with-the-table.md
import { Fragment, useSyncExternalStore } from "react";
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
import type { QueryLayout } from "./layouts";
import { RecordGroupHeading, useRecordGroups } from "./record-rows";
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

/** The rows of the shown view as a reading list, under their group headings. */
export function PapersLayout({ view }: { view: QueryView }) {
  const { groups } = useRecordGroups(view);
  const { query, literatureNotes, readers } = view.tableDeps;
  const { children: expanded, toggle } = useChildren(query);
  return (
    <div
      className="zt:min-h-0 zt:flex-1 zt:overflow-auto zt:px-1 zt:pb-11 zt:not-in-[.zt-query-note]:scroll-gutter zt:in-[.zt-query-note]:pb-2"
      data-query-layout="papers"
    >
      {groups.map((group, groupIndex) => (
        <section key={`${groupIndex}\n${group.key ?? ""}`}>
          <RecordGroupHeading group={group} />
          {!group.collapsed && (
            <ul className="zt:m-0 zt:list-none zt:p-0">
              {group.rows.map(({ row }, index) => {
                const item: TableRecord = {
                  kind: "item",
                  key: row.indexedKey,
                  values: row.values,
                };
                return (
                  <PaperRow
                    key={`${row.indexedKey}\n${index}`}
                    item={item}
                    reason={view.reason(row)}
                    notes={literatureNotes}
                    readers={readers}
                    expanded={expanded}
                    toggle={toggle}
                    gestures={view.rows}
                  />
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

interface Expansion {
  readonly expanded: ReadonlyMap<string, ChildState>;
  readonly toggle: (record: TableRecord) => void;
  readonly readers: TargetOpenGesture;
}

function PaperRow({
  item,
  notes,
  readers,
  expanded,
  toggle,
  reason,
  gestures,
}: Expansion & {
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
          <div
            id={titleId}
            className="zt:truncate zt:text-sm zt:font-(--font-medium) zt:text-foreground"
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
          notes.open(note, event.nativeEvent);
        }}
      >
        {note.basename}
      </a>
    </li>
  );
}
