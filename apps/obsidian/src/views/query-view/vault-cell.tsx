// A vault property of one row, as each Layout shows it: the value of the
// frontmatter key on the Item's Literature Note, an empty cell where the note
// lacks the key or holds null, and a placeholder where the Item has no note
// to read it from. A cell reads again when the note's frontmatter changes,
// with no new run of the view's query. In the Table a cell looks and edits
// as a Bases cell does, by the property's type: one line of text, a link, a
// number at the end, a checkbox, a date in the locale's form, or a row of
// items or tags, clipped at the cell's edge; an edit opens over the cell and
// grows down over the rows below, so no row moves. A key the note's Profile
// replaces on each update stays read-only. On a row with no note, the commit
// of an edit creates the note first; opening the editor creates nothing.
//
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

import { valueText } from "@zotlit/item-query";
import type { ProjectionJson } from "@zotlit/item-query";
import { useUniqueId } from "@zotlit/ui";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { cn, tooltipAttrs } from "@/lib/utils";

import { LIST_TYPES } from "./table-notes";
import type {
  LiteratureNotes,
  VaultHost,
  VaultPropertyType,
  VaultValue,
  VaultWrite,
} from "./table-notes";
import {
  FIELD,
  PILL,
  TAG,
  VaultEditor,
  draftOf,
  listItems,
  valueOf,
} from "./vault-editors";
import type { VaultDraft, VaultEditEnd } from "./vault-editors";
import { dateInputValue, linkOf, tagText } from "./vault-value";
import "./vault-cell.css";

/** The vault property `name` of the Item `itemKey`, and where it is read. */
export interface VaultCellProps {
  readonly notes: LiteratureNotes;
  readonly itemKey: string;
  readonly name: string;
  /** The note that holds the view, where a note holds it. */
  readonly host: VaultHost | null;
}

/** What a vault cell shows: no note, an empty value, or a value. */
export type VaultCellState = "no-note" | "empty" | "value";

/** The state of a vault property of one row. */
export function vaultState(value: VaultValue): VaultCellState {
  if (!value.note) return "no-note";
  return vaultText(value) === "" ? "empty" : "value";
}

/**
 * The text of a vault property, as copy and CSV write it and the search
 * finds it: no text where the Item has no note.
 */
export function vaultText(value: VaultValue): string {
  return value.note ? valueText(value.value as ProjectionJson) : "";
}

/** Run `listener` on any change of the Literature Notes or their frontmatter. */
export function onVaultChange(
  notes: Pick<LiteratureNotes, "on">,
  listener: () => void,
): () => void {
  const offNotes = notes.on("changed", listener);
  const offFrontmatter = notes.on("frontmatter-changed", listener);
  return () => {
    offNotes();
    offFrontmatter();
  };
}

/**
 * A count that grows on each change of the Literature Notes or their
 * frontmatter, for a part that reads many vault properties at once to read
 * them again.
 */
export function useVaultVersion(notes: Pick<LiteratureNotes, "on">): number {
  const [version, changed] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onVaultChange(notes, changed), [notes]);
  return version;
}

/** The names the vault properties take, as the Literature Notes give them now. */
export function useVaultPropertyNames(
  notes: Pick<LiteratureNotes, "on" | "propertyNames">,
): readonly string[] {
  const subscribe = useCallback(
    (listener: () => void) => onVaultChange(notes, listener),
    [notes],
  );
  // One line a name, so unchanged names are the same snapshot.
  const lines = useSyncExternalStore(subscribe, () =>
    notes.propertyNames().join("\n"),
  );
  return useMemo(() => (lines === "" ? [] : lines.split("\n")), [lines]);
}

/** The vault property `name` of the Item `itemKey`, as it is now. */
export function useVaultValue({
  notes,
  itemKey,
  name,
  host,
}: VaultCellProps): VaultValue {
  const subscribe = useCallback(
    (listener: () => void) => onVaultChange(notes, listener),
    [notes],
  );
  // A snapshot of text, so an unchanged value is the same snapshot.
  const snapshot = useSyncExternalStore(subscribe, () =>
    JSON.stringify(notes.read(itemKey, name, host)),
  );
  return JSON.parse(snapshot) as VaultValue;
}

/**
 * The type of the vault property `name`, as it is now: of a cell that holds
 * `value`, where one is given.
 */
export function useVaultType(
  notes: Pick<LiteratureNotes, "on" | "propertyType">,
  name: string,
  value?: unknown,
): VaultPropertyType {
  const subscribe = useCallback(
    (listener: () => void) => onVaultChange(notes, listener),
    [notes],
  );
  return useSyncExternalStore(subscribe, () => notes.propertyType(name, value));
}

/** Whether the note's Profile replaces the vault property, as it does now. */
function useVaultManaged({
  notes,
  itemKey,
  name,
  host,
}: VaultCellProps): boolean {
  const subscribe = useCallback(
    (listener: () => void) => onVaultChange(notes, listener),
    [notes],
  );
  return useSyncExternalStore(subscribe, () =>
    notes.managed(itemKey, name, host),
  );
}

/** The message a write of the vault property `name` that did not land shows. */
function unwrittenMessage(result: VaultWrite, name: string): string | null {
  switch (result) {
    case "cancelled":
      return m.query_view_vault_not_written({ name });
    case "managed":
      return m.query_view_vault_managed_not_written({ name });
    default:
      return null;
  }
}

/** One vault cell on screen in the List and Cards: its text. */
export function VaultCellContent({ value }: { value: VaultValue }) {
  const state = vaultState(value);
  return (
    <span
      data-query-vault={state}
      className={state === "no-note" ? "zt:text-(--text-faint)" : undefined}
    >
      {state === "no-note" ? m.query_view_vault_no_note() : vaultText(value)}
    </span>
  );
}

/** The vault cell of `name` for the Item `itemKey`. */
export function VaultCell(props: VaultCellProps) {
  return <VaultCellContent value={useVaultValue(props)} />;
}

const logger = getLogger("QueryView");

/**
 * The line a Table cell shows at rest: one line at the row's height, which
 * clips what does not fit. A column the researcher sized takes its width
 * from its header; another stops at the width of a Bases column.
 */
const REST =
  "zt:flex zt:h-full zt:max-w-75 zt:min-w-0 zt:items-center zt:overflow-hidden zt:px-2 zt:whitespace-nowrap zt:group-data-sized/cell:w-0 zt:group-data-sized/cell:max-w-none zt:group-data-sized/cell:min-w-full";

/** What a Table cell shows of its value at rest, by the property's type. */
function VaultPreview({
  props: { notes, itemKey, host },
  value,
  type,
  checkbox,
  editing,
}: {
  props: VaultCellProps;
  value: VaultValue;
  type: VaultPropertyType;
  /** The cell edits, so the line under the editor only holds its width. */
  editing: boolean;
  /** The checkbox of a note's checkbox property. */
  checkbox: ReactNode;
}): ReactNode {
  const state = vaultState(value);
  if (!value.note)
    return (
      <span
        data-query-vault={state}
        className="zt:truncate zt:text-(--text-faint)"
      >
        {m.query_view_vault_no_note()}
      </span>
    );
  if (type === "checkbox") return checkbox;
  const current = value.value;
  if (LIST_TYPES.has(type)) {
    const tags = type === "tags";
    return (
      <span
        data-query-vault={state}
        className="zt:flex zt:min-w-0 zt:items-center zt:gap-(--size-2-2)"
      >
        {listItems(current).map((item, at) => (
          <span
            // Items may repeat, so the place keys each.
            key={at}
            data-query-vault-chip={editing ? undefined : item}
            className={cn(PILL, tags && TAG)}
          >
            {tags ? tagText(item) : item}
          </span>
        ))}
      </span>
    );
  }
  const text = vaultText(value);
  const date =
    type === "date" || type === "datetime" ? dateInputValue(type, text) : "";
  if (date !== "")
    // The read-only native field shows the date as the field that edits it
    // does, and as a Bases cell does: in the system's form, with its icon.
    return (
      <input
        data-query-vault={state}
        data-query-vault-date=""
        type={type === "date" ? "date" : "datetime-local"}
        value={date}
        // Inert rather than read-only, which would hide the field's icon:
        // the cell takes the click and the keys, as for any other value.
        inert
        tabIndex={-1}
        className={cn(
          FIELD,
          "zt:pointer-events-none zt:-ms-2 zt:ps-7 zt:tabular-nums",
        )}
      />
    );
  const link =
    type === "text" && typeof current === "string" ? linkOf(current) : null;
  if (link?.kind === "internal") {
    const ref = { target: link.target, itemKey, host };
    return (
      <a
        data-query-vault={state}
        className="internal-link zt:truncate zt:data-unresolved:opacity-(--link-unresolved-opacity)"
        href={link.target}
        data-href={link.target}
        data-unresolved={notes.resolves(ref) ? undefined : ""}
        onClick={(event) => {
          // The link opens its note; the cell does not enter edit.
          event.preventDefault();
          event.stopPropagation();
          notes.openLink(ref, event.nativeEvent);
        }}
      >
        {link.text}
      </a>
    );
  }
  if (link?.kind === "external")
    return (
      <a
        data-query-vault={state}
        className="external-link zt:truncate"
        href={link.target}
        target="_blank"
        rel="noopener nofollow"
        onClick={(event) => event.stopPropagation()}
      >
        {link.text}
      </a>
    );
  return (
    <span
      data-query-vault={state}
      className={cn("zt:truncate", type === "number" && "zt:tabular-nums")}
    >
      {text}
    </span>
  );
}

/** The vault cell after or before `cell` in its row that takes an edit. */
function neighbour(
  cell: HTMLElement,
  how: "next" | "previous",
): HTMLElement | undefined {
  const cells = [
    ...(cell
      .closest("tr")
      ?.querySelectorAll<HTMLElement>("[data-query-vault-cell][tabindex]") ??
      []),
  ];
  return cells[cells.indexOf(cell) + (how === "next" ? 1 : -1)];
}

/**
 * The vault cell of `name` for the Item `itemKey` in the Table, which looks
 * and edits as a Bases cell does. The whole cell is the target of an edit,
 * by a click or by Enter or Space, where the note's Profile does not
 * replace the key; a click toggles a checkbox. The editor opens over the
 * cell in the Bases edit ring and grows down over the rows below, so no row
 * moves. Enter, Tab or focus leaving the editor writes it, creating the
 * note where the Item has none; Escape drops it. After Enter or Escape
 * focus returns to the cell; Tab and Shift+Tab move it to the next or the
 * previous vault cell of the row. The click stops at the cell, so the
 * gesture of the row or the block that holds the view does not run.
 */
export function VaultEditCell(props: VaultCellProps) {
  const { notes, itemKey, name, host } = props;
  const value = useVaultValue(props);
  const current = value.note ? value.value : null;
  const type = useVaultType(notes, name, current);
  const managed = useVaultManaged(props) && value.note;
  const [draft, setDraft] = useState<VaultDraft | null>(null);
  // Set when a key ends the edit, so the blur that follows the field
  // leaving the page does not end it again.
  const ended = useRef(false);
  /** Where focus goes once the editor has left the page. */
  const after = useRef<VaultEditEnd | null>(null);
  const cell = useRef<HTMLDivElement>(null);
  const labelId = useUniqueId();
  const editing = draft !== null;
  useLayoutEffect(() => {
    const how = after.current;
    if (editing || how === null) return;
    after.current = null;
    const el = cell.current;
    if (!el || how === "leave") return;
    (how === "stay" ? el : (neighbour(el, how) ?? el)).focus();
  }, [editing]);
  // A row with no note edits too: the first write creates the note.
  const editable = !managed;
  const write = (next: unknown) =>
    notes
      .write({ itemKey, name, value: next, host })
      .then((result) => {
        const message = unwrittenMessage(result, name);
        if (message !== null) new BaseNotice(message);
      })
      .catch((error: unknown) => {
        logger.warn("The Query View could not write a vault property", {
          error,
          name,
        });
        new BaseNotice(m.query_view_vault_write_failed({ name }));
      });
  const begin = () => {
    ended.current = false;
    setDraft(draftOf(type, current));
  };
  const end = (commit: boolean, edited: VaultDraft, how: VaultEditEnd) => {
    if (ended.current) return;
    ended.current = true;
    after.current = how;
    setDraft(null);
    const next = valueOf(type, edited);
    // Text that is no value of the type, or the value unchanged, writes nothing.
    if (!commit || next === undefined) return;
    if (
      JSON.stringify(next) ===
      JSON.stringify(valueOf(type, draftOf(type, current)))
    )
      return;
    void write(next);
  };
  const checkbox = type === "checkbox";
  // A checkbox of a note is its own control; any other cell is one.
  const target = editable && !editing && !(checkbox && value.note);
  const activate = () => {
    if (!editable || editing) return;
    // A checkbox of a row with no note toggles on, creating the note.
    if (!checkbox) begin();
    else if (!value.note) void write(true);
  };
  return (
    <>
      {/* The name of the cell, its checkbox and its field, held apart from
          them: an `aria-label` would reach the pointer too, and Obsidian
          would draw it as a tooltip over the next row for the whole edit.
          `hidden` keeps it out of the cell's text and reading order; a
          reference still reads it. @see apps/obsidian/policies/tooltips.md */}
      <span id={labelId} hidden>
        {m.query_view_vault_edit({ name })}
      </span>
      <div
        ref={cell}
        data-query-vault-cell=""
        data-query-vault-name={name}
        data-query-vault-type={type}
        // The cell fills the table cell, above its row line, so an empty
        // value is a target too.
        // An editable cell shows the Bases cell ring on hover and focus.
        className={cn(
          "zt:group/vault zt:relative zt:h-[calc(var(--bases-table-row-height)-var(--border-width))] zt:w-full zt:min-w-0 zt:outline-none",
          editable &&
            !editing &&
            "zt:rounded-(--bases-table-cell-radius-active) zt:hover:z-1 zt:hover:shadow-(--bases-table-cell-shadow-active) zt:focus-visible:z-1 zt:focus-visible:shadow-(--bases-table-cell-shadow-active)",
          target && !checkbox && "zt:cursor-text",
        )}
        role={target ? "button" : undefined}
        // Tab and Shift+Tab find an editable cell, its own too while it edits.
        tabIndex={target ? 0 : editing ? -1 : undefined}
        aria-labelledby={target ? labelId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          activate();
        }}
        onKeyDown={(event) => {
          if (!target || event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          activate();
        }}
        // Focus that leaves the whole editor, from its field or a pill,
        // ends the edit; focus that moves inside it does not.
        onBlur={(event) => {
          if (draft === null) return;
          if (event.currentTarget.contains(event.relatedTarget as Node | null))
            return;
          end(true, draft, "leave");
        }}
      >
        <div
          className={cn(
            REST,
            type === "number" && "zt:justify-end",
            checkbox && value.note && "zt:justify-center",
            managed && "zt:group-hover/vault:pe-6",
            editing && "zt:invisible",
          )}
          aria-hidden={editing || undefined}
        >
          <VaultPreview
            props={props}
            value={value}
            type={type}
            editing={editing}
            checkbox={
              <input
                data-query-vault-checkbox=""
                type="checkbox"
                aria-labelledby={labelId}
                checked={current === true}
                // A note that lacks the key, or holds no value, shows the
                // indeterminate box, as Bases does; `false` is an empty box.
                data-indeterminate={current == null ? "true" : undefined}
                aria-checked={current == null ? "mixed" : current === true}
                disabled={!editable}
                onChange={() => void write(current !== true)}
              />
            }
          />
        </div>
        {managed && (
          // The lock keeps the read-only mark and its tooltip, and shows on
          // hover, over the end of the cell, rather than taking a place.
          <span
            data-query-vault-managed=""
            className="zt:invisible zt:absolute zt:inset-y-0 zt:end-0 zt:flex zt:items-center zt:px-2 zt:text-(--text-faint) zt:group-hover/vault:visible"
            {...tooltipAttrs(m.query_view_vault_managed())}
          >
            <Icon name="lock" size="var(--icon-xs)" />
          </span>
        )}
        {draft !== null && (
          <div
            data-query-vault-editor=""
            className="zt:absolute zt:inset-x-0 zt:top-0 zt:z-1 zt:min-h-full zt:rounded-(--bases-table-cell-radius-focus) zt:bg-(--bases-table-cell-background-active) zt:shadow-(--bases-table-cell-shadow-focus)"
          >
            <VaultEditor
              type={type}
              labelId={labelId}
              draft={draft}
              onDraft={setDraft}
              onEnd={end}
              suggestions={() => notes.suggestions(name, type)}
            />
          </div>
        )}
      </div>
    </>
  );
}
