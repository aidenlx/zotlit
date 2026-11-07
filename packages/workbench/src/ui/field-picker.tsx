// The Fields picker: the Fields Panel's fields as a list to filter and pick
// from, which the Fields action opens over the editor while the panel's
// column does not fit. The rows, the filter and the open state are the
// picker's; the surface it opens in, its placement, its dismissal and the
// focus at closing are the host's (ADR 0044).
//
// Focus stays in the search field, which names the active row as its active
// descendant and the detail area under the list as its description, so a
// screen reader reads the row and its full value at each move.
import type { DisplayNode } from "#/explorer/index";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { useUniqueId } from "@zotlit/ui";

import { useWorkbenchModel } from "./editor";
import { fieldValueText } from "./explorer-fields";
import type { FieldRow } from "./explorer-fields";
import { explorerSections } from "./explorer-sections";
import type { ExplorerReader } from "./explorer-sections";
import { HiddenName, useOptionalHost } from "./host";
import type { WorkbenchPickerKeys, WorkbenchPickerMove } from "./host";
import { useWorkbenchMessages } from "./messages";
import type { WorkbenchMessageLabel } from "./messages";
import type { TemplateRoot } from "./model";
import type { FieldsAction } from "./panel-layout";
import { useParts } from "./theme";

import {
  buildDisplayTree,
  buildFilteredDisplayTree,
  formatPath,
  previewLine,
} from "#/explorer/index";

export interface FieldPickerProps {
  readonly root: TemplateRoot;
  /** The fields of the chosen Item on `root`, or null while there are none. */
  readonly data: Record<string, unknown> | null;
  /** What the picker says while `data` is null: no Item, or one loading. */
  readonly empty?: string;
  /** Whether the editor takes no field now: it holds no cursor, or is read-only. */
  readonly disabled?: boolean;
  /** Inserts the field at the editor's cursor; `false` when the editor refused it. */
  readonly onInsertNode: (node: DisplayNode) => boolean | void;
}

/** One group of rows, under its section's name. */
interface PickerSection {
  readonly id: string;
  readonly label: string;
  readonly rows: readonly FieldRow[];
}

/** What each root's field search says it searches. */
const SEARCH_LABELS: Record<TemplateRoot, WorkbenchMessageLabel> = {
  note: "workbench_fields_search_note",
  annotation: "workbench_fields_search_annotation",
  filename: "workbench_fields_search_filename",
  citation: "workbench_fields_search_citation",
};

/** How many rows PageDown and PageUp move by. */
const PAGE = 10;

/**
 * The rows the picker lists for `query`. With no query, the top-level fields
 * in the Fields Panel's sections and order. With one, every field that
 * matches it at any depth, under the section of the top-level field it
 * stands in; a nested field goes by its path.
 */
function pickerSections(
  data: Record<string, unknown> | null,
  query: string,
  reader: ExplorerReader,
): PickerSection[] {
  if (!data) return [];
  const top = explorerSections(
    buildDisplayTree(data, { expanded: new Set() }),
    reader,
  );
  if (query === "") return top;
  const aliases = new Map(
    top.flatMap((section) =>
      section.rows.map((row) => [row.node.key, row.label] as const),
    ),
  );
  const { nodes, matchedKeys } = buildFilteredDisplayTree(data, query, {
    aliases,
  });
  const matched = (row: FieldRow): FieldRow[] => {
    const rows = matchedKeys.has(row.node.key) ? [row] : [];
    const walk = (node: DisplayNode) => {
      if (node.kind !== "value") return;
      for (const child of node.children ?? []) {
        if (matchedKeys.has(child.key))
          rows.push({
            node: child,
            label: formatPath(child.path),
            value: fieldValueText(child),
          });
        walk(child);
      }
    };
    walk(row.node);
    return rows;
  };
  return explorerSections(nodes, reader)
    .map((section) => ({ ...section, rows: section.rows.flatMap(matched) }))
    .filter((section) => section.rows.length > 0);
}

/**
 * The keys that move the picker's active row in every host, by the key's
 * name. The Obsidian view adds Ctrl+N and Ctrl+P, as its lists do.
 */
export const PICKER_MOVE_KEYS: Readonly<Record<string, WorkbenchPickerMove>> = {
  ArrowDown: "next",
  ArrowUp: "previous",
  PageDown: "page-down",
  PageUp: "page-up",
  Home: "first",
  End: "last",
};

/**
 * What a key on the Fields action opens the picker on, where the action
 * opens the closed picker: an empty search for ArrowDown and ArrowUp, the
 * key itself for a printable one, as a Bases combobox opens. Null for every
 * other key, Enter and Space among them, which press the action.
 */
export function fieldsActionKey(
  action: FieldsAction,
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">,
): string | null {
  if (action.opens !== "popover" || action.open) return null;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") return "";
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  return [...event.key].length === 1 && event.key !== " " ? event.key : null;
}

/**
 * The Fields action's ARIA state: a toggle where it shows the column, and a
 * disclosure of the picker `popoverId` names where it opens the picker. An
 * attribute the action does not carry is undefined.
 */
export function fieldsActionAttributes(
  action: FieldsAction,
  popoverId: string,
): {
  readonly "aria-pressed": "true" | "false" | undefined;
  readonly "aria-haspopup": "dialog" | undefined;
  readonly "aria-expanded": "true" | "false" | undefined;
  readonly "aria-controls": string | undefined;
} {
  const open = action.open ? "true" : "false";
  return action.opens === "column"
    ? {
        "aria-pressed": open,
        "aria-haspopup": undefined,
        "aria-expanded": undefined,
        "aria-controls": undefined,
      }
    : {
        "aria-pressed": undefined,
        "aria-haspopup": "dialog",
        "aria-expanded": open,
        "aria-controls": action.open ? popoverId : undefined,
      };
}

/**
 * Keeps focus where it is when the pointer presses the Fields action while
 * the picker stands, so the press closes the picker from inside it and
 * focus goes back to the action, as Escape's does. Hosts call it on the
 * action's `mousedown`, whose default moves focus. A cancelled `pointerdown`
 * would also cancel the mouse events after it, `mouseup` among them.
 */
export function holdPickerFocus(
  action: FieldsAction,
  event: Pick<Event, "preventDefault">,
): void {
  if (action.opens === "popover" && action.open) event.preventDefault();
}

/** The active row after `step` among `count` rows; the arrows wrap. */
function moved(at: number, step: WorkbenchPickerMove, count: number): number {
  if (count === 0) return 0;
  switch (step) {
    case "next":
      return (at + 1) % count;
    case "previous":
      return (at - 1 + count) % count;
    case "first":
      return 0;
    case "last":
      return count - 1;
    case "page-down":
      return Math.min(count - 1, at + PAGE);
    case "page-up":
      return Math.max(0, at - PAGE);
  }
}

/**
 * The picker under the host's Fields action, and the status line that
 * announces an insertion from it. The status line stands while the picker
 * is closed, so its text is announced when it changes.
 */
export function FieldPicker({
  root,
  data,
  empty,
  disabled = false,
  onInsertNode,
}: FieldPickerProps) {
  const model = useWorkbenchModel();
  const host = useOptionalHost();
  const m = useWorkbenchMessages();
  const part = useParts("fieldPicker");
  const picker = useAtomValue(model.fieldsPicker);
  const setPicker = useAtomSet(model.fieldsPicker);
  const open = picker !== null;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  // An insertion closes the picker and gives the editor focus.
  const [inserted, setInserted] = useState(false);
  // Each opening starts at the first row, on the search the reader started
  // on the Fields action or on none.
  const [opened, setOpened] = useState(picker);
  if (picker !== opened) {
    setOpened(picker);
    if (picker) {
      setQuery(picker.query);
      setActive(0);
      setAnnouncement("");
      setInserted(false);
    }
  }
  const locale = host?.getLocale() ?? "en";
  const sections = useMemo(
    () => pickerSections(data, query, { m, root, locale }),
    [data, query, m, root, locale],
  );
  const rows = useMemo(
    () => sections.flatMap((section) => section.rows),
    [sections],
  );
  const index = rows.length === 0 ? -1 : Math.min(active, rows.length - 1);

  const latest = useRef({ rows, index, disabled, onInsertNode });
  useLayoutEffect(() => {
    latest.current = { rows, index, disabled, onInsertNode };
  });
  const insert = (row: FieldRow | undefined) => {
    if (!row || latest.current.disabled) return;
    if (latest.current.onInsertNode(row.node) === false) return;
    setAnnouncement(m.workbench_fields_inserted({ field: row.label }));
    setInserted(true);
    setPicker(null);
  };
  const keys: WorkbenchPickerKeys = {
    move: (step) =>
      setActive((at) =>
        moved(
          Math.min(at, latest.current.rows.length - 1),
          step,
          latest.current.rows.length,
        ),
      ),
    choose: () => insert(latest.current.rows[latest.current.index]),
  };

  const Popover = host?.fieldsAction?.popover;
  const labelId = useUniqueId();
  return (
    <>
      <div role="status" {...part("status")}>
        {announcement}
      </div>
      {Popover && (
        <Popover
          open={open}
          onClose={() => setPicker(null)}
          keys={keys}
          labelledBy={labelId}
          returnFocus={!inserted}
        >
          <PickerContent
            labelId={labelId}
            search={m[SEARCH_LABELS[root]]()}
            query={query}
            onQuery={(next) => {
              setQuery(next);
              setActive(0);
            }}
            sections={sections}
            index={index}
            onActive={setActive}
            onPick={(at) => insert(rows[at])}
            hint={disabled ? m.workbench_fields_choose_place() : null}
            empty={
              data === null ? (empty ?? null) : m.workbench_fields_no_matches()
            }
          />
        </Popover>
      )}
    </>
  );
}

function PickerContent({
  labelId,
  search,
  query,
  onQuery,
  sections,
  index,
  onActive,
  onPick,
  hint,
  empty,
}: {
  labelId: string;
  search: string;
  query: string;
  onQuery: (query: string) => void;
  sections: readonly PickerSection[];
  index: number;
  onActive: (index: number) => void;
  onPick: (index: number) => void;
  hint: string | null;
  empty: string | null;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("fieldPicker");
  const id = useUniqueId();
  const input = useRef<HTMLInputElement>(null);
  const optionId = (at: number) => `${id}-option-${at}`;
  const listId = `${id}-list`;
  const detailId = `${id}-detail`;
  const hintId = `${id}-hint`;
  const searchId = `${id}-search`;
  // The host mounts the contents as its surface opens.
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    if (index < 0) return;
    const option = input.current?.ownerDocument.getElementById(optionId(index));
    option?.scrollIntoView({ block: "nearest" });
  });
  let at = 0;
  const groups = sections.map((section) => {
    const groupId = `${id}-group-${section.id}`;
    return (
      <div
        key={section.id}
        role="group"
        aria-labelledby={groupId}
        {...part("group")}
      >
        <div id={groupId} role="presentation" {...part("group-label")}>
          {section.label}
        </div>
        {section.rows.map((row) => {
          const rowAt = at++;
          const current = rowAt === index;
          return (
            <div
              key={row.node.key}
              id={optionId(rowAt)}
              role="option"
              aria-selected={current}
              // The active row reads its whole value with its name.
              aria-describedby={current ? detailId : undefined}
              // The search field keeps focus while the pointer picks a row.
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => {
                if (!current) onActive(rowAt);
              }}
              onClick={() => onPick(rowAt)}
              {...part("option", current ? "active" : undefined)}
            >
              <span {...part("option-label")}>{row.label}</span>
              {row.value !== "" && (
                <span {...part("option-value")}>{previewLine(row.value)}</span>
              )}
            </div>
          );
        })}
      </div>
    );
  });
  const rows = sections.flatMap((section) => section.rows);
  const current = index < 0 ? null : rows[index]!;
  return (
    <div {...part("picker")}>
      <HiddenName id={labelId}>{m.workbench_view_fields()}</HiddenName>
      <HiddenName id={searchId}>{search}</HiddenName>
      {/* A text field, not a search field: a search field answers Escape
          itself by clearing its text, and the host's Escape closes the
          picker. */}
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={current ? optionId(index) : undefined}
        // The reason Enter cannot insert, when there is one, is read with
        // the active row's value.
        aria-describedby={hint ? `${detailId} ${hintId}` : detailId}
        aria-labelledby={searchId}
        placeholder={search}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => onQuery(event.currentTarget.value)}
        {...part("search")}
      />
      {hint && (
        <p id={hintId} {...part("hint")}>
          {hint}
        </p>
      )}
      <div
        id={listId}
        role="listbox"
        aria-labelledby={labelId}
        // The search field holds focus and names the active row.
        tabIndex={-1}
        {...part("list")}
      >
        {groups}
      </div>
      {/* Stands empty while there are rows, so the line that says the
          search matched nothing is announced as it appears. */}
      <div role="status" {...part("empty")}>
        {rows.length === 0 ? empty : null}
      </div>
      <div id={detailId} {...part("detail")}>
        {current && (
          <>
            <code {...part("detail-path")}>
              {formatPath(current.node.path, "zt")}
            </code>
            {current.value !== "" && (
              <span {...part("detail-value")}>{current.value}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
