// The Papers layout: the Items of a view as a reading list. Each row shows
// the title; the creators, the year and the Venue on a second line; and a
// reading-state line under them. It ends with the kind of the Item's main
// Attachment and a mark for its Literature Note, and expands into the rows
// the Table expands into.
//
// @see apps/obsidian/docs/adr/0074-the-papers-layout-is-a-query-view-layout-the-library-view-offers-with-the-table.md
import { Fragment, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";

import { resolveVenue } from "@zotlit/db";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { cn, tooltipAttrs } from "@/lib/utils";
import type { QueryViewValue } from "@/services/item-query/query-view";

import type { QueryLayout } from "./layouts";
import { RecordGroupHeading, useRecordGroups } from "./record-rows";
import {
  Expander,
  ReaderLink,
  TABLE_CHILD_SOURCES,
  TABLE_FIELDS,
  id,
  useChildren,
} from "./table-layout";
import type { ChildState, TableRecord } from "./table-layout";
import type { LiteratureNotes } from "./table-notes";
import type { ReaderTarget, TableReaders } from "./table-readers";
import type { QueryView } from "./view";

export const PAPERS_LAYOUT: QueryLayout = {
  type: "papers",
  datasets: ["items"],
  name: () => m.query_view_layout_papers(),
  icon: "library",
};

/**
 * The paths each Papers row reads beside the visible properties: its lines,
 * its reading state, its Attachment kinds and what it expands into.
 */
export const PAPERS_FIELDS: readonly string[] = [
  "title",
  "creators",
  "date",
  "publicationTitle",
  "publisher",
  "annotations[].color",
  "attachments[].fileType",
  ...TABLE_FIELDS,
];

/** The most creators the second line names before "et al.". */
const SHOWN_CREATORS = 3;
/** The most colours the reading-state line shows. */
const SHOWN_COLORS = 5;

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
function metaText(values: TableRecord["values"]): string {
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

/** The colours of the Item's Annotations, the most used first. */
function annotationColors(colors: readonly QueryViewValue[]): string[] {
  const counts = new Map<string, number>();
  for (const color of colors)
    if (typeof color === "string" && color !== "")
      counts.set(color, (counts.get(color) ?? 0) + 1);
  return [...counts]
    .sort(([, a], [, b]) => b - a)
    .slice(0, SHOWN_COLORS)
    .map(([color]) => color);
}

function mainAttachmentKind(values: TableRecord["values"]) {
  const types = list(values["attachments[].fileType"]);
  return ATTACHMENT_KINDS.find((kind) => types.includes(kind.type)) ?? null;
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
      className="zt:min-h-0 zt:flex-1 zt:overflow-auto zt:px-1 zt:pb-11 zt:in-[.zt-query-note]:pb-2"
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
                    notes={literatureNotes}
                    readers={readers}
                    expanded={expanded}
                    toggle={toggle}
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
  readonly readers: TableReaders;
}

function PaperRow({
  item,
  notes,
  readers,
  expanded,
  toggle,
}: Expansion & { item: TableRecord; notes: LiteratureNotes }) {
  const open = expanded.has(id(item));
  const { values } = item;
  const note = useNotePath(notes, item.key);
  const annotations = list(values["annotations[].color"]);
  const colors = annotationColors(annotations);
  const state = [
    annotations.length > 0
      ? m.query_view_papers_annotation_count({ count: annotations.length })
      : null,
    note !== null ? m.query_view_papers_has_note() : null,
  ].filter((part) => part !== null);
  const meta = metaText(values);
  const kind = mainAttachmentKind(values);
  return (
    <li
      className="zt:border-b-(length:--border-width) zt:border-(--background-modifier-border)"
      data-query-papers-row={item.key}
    >
      <div className="zt:flex zt:items-start zt:gap-1 zt:rounded-(--radius-s) zt:px-1 zt:py-1.5 zt:hover:bg-(--background-modifier-hover)">
        <Expander record={item} open={open} onToggle={() => toggle(item)} />
        <div className="zt:min-w-0 zt:flex-1">
          <div
            className="zt:line-clamp-2 zt:text-(length:--font-ui-small) zt:font-(--font-medium) zt:text-(--text-normal)"
            data-query-papers-title=""
          >
            {text(values.title)}
          </div>
          {meta !== "" && (
            <div
              className="zt:truncate zt:text-(length:--font-ui-smaller) zt:text-(--text-muted)"
              data-query-papers-meta=""
            >
              {meta}
            </div>
          )}
          {state.length > 0 && (
            <div
              className="zt:flex zt:items-center zt:gap-1 zt:text-(length:--font-ui-smaller) zt:text-(--text-faint)"
              data-query-papers-state=""
            >
              {colors.length > 0 && (
                <span className="zt:flex zt:shrink-0 zt:gap-0.5">
                  {colors.map((color) => (
                    <span
                      key={color}
                      className="zt:inline-block zt:size-2 zt:rounded-xs zt:bg-(--zt-annot-color)"
                      style={{ "--zt-annot-color": color } as CSSProperties}
                      data-query-papers-color={color}
                    />
                  ))}
                </span>
              )}
              <span className="zt:truncate">{state.join(" · ")}</span>
            </div>
          )}
        </div>
        <div className="zt:flex zt:shrink-0 zt:items-center zt:gap-1 zt:pt-0.5 zt:text-(--icon-color)">
          {note !== null && (
            <span
              role="img"
              className="zt:flex"
              data-query-papers-note=""
              {...tooltipAttrs(m.query_view_papers_note_marker())}
            >
              <Icon
                name="notebook-pen"
                size="var(--icon-xs)"
                strokeWidth="var(--icon-xs-stroke-width)"
              />
            </span>
          )}
          {kind && (
            <span
              role="img"
              className="zt:flex"
              data-query-papers-attachment={kind.type}
              {...tooltipAttrs(kind.label())}
            >
              <Icon
                name={kind.icon}
                size="var(--icon-xs)"
                strokeWidth="var(--icon-xs-stroke-width)"
              />
            </span>
          )}
        </div>
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
  "zt:flex zt:min-w-0 zt:items-center zt:gap-1.5 zt:rounded-(--radius-s) zt:py-0.5 zt:ps-(--zt-indent) zt:pe-1 zt:text-(length:--font-ui-smaller) zt:hover:bg-(--background-modifier-hover)";

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
  if (state.phase !== "ready")
    return (
      <li
        className={cn(CHILD_ROW, "zt:text-(--text-muted)")}
        style={indent(depth)}
        data-query-table-status={state.phase}
      >
        {state.phase === "loading"
          ? m.query_view_table_loading()
          : m.query_view_table_children_failed()}
      </li>
    );
  const link = (target: ReaderTarget, children: ReactNode) => (
    <ReaderLink readers={readers} target={target}>
      {children}
    </ReaderLink>
  );
  return state.rows.map((record) => {
    const source = TABLE_CHILD_SOURCES.find(
      (candidate) => candidate.kind === record.kind,
    )!;
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
            size="var(--icon-xs)"
            strokeWidth="var(--icon-xs-stroke-width)"
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
      <Expander
        record={{ kind: "note", key: note.path, values: {} }}
        open={false}
        onToggle={() => {}}
      />
      <Icon
        name="notebook-pen"
        size="var(--icon-xs)"
        strokeWidth="var(--icon-xs-stroke-width)"
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
