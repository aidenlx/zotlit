// A vault property of one row, as each Layout shows it: the value of the
// frontmatter key on the Item's Literature Note, an empty cell where the note
// lacks the key or holds null, and a placeholder where the Item has no note
// to read it from. A cell reads again when the note's frontmatter changes,
// with no new run of the view's query. In the Table a cell edits in place
// with the editor of the property's type; a key the note's Profile replaces
// on each update stays read-only. On a row with no note, the commit of an
// edit creates the note first; opening the editor creates nothing.
//
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { valueText } from "@zotlit/item-query";
import type { ProjectionJson } from "@zotlit/item-query";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { cn } from "@/lib/utils";

import type {
  LiteratureNotes,
  VaultHost,
  VaultPropertyType,
  VaultValue,
  VaultWrite,
} from "./table-notes";
import {
  VaultChips,
  VaultEditor,
  draftOf,
  listItems,
  valueOf,
} from "./vault-editors";
import type { VaultDraft } from "./vault-editors";

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

/** One vault cell on screen. */
export function VaultCellContent({ value }: { value: VaultValue }) {
  const state = vaultState(value);
  return (
    <span
      data-query-vault={state}
      className={
        state === "no-note" ? "zt:text-(--text-faint) zt:italic" : undefined
      }
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
 * The vault cell of `name` for the Item `itemKey` in the Table: a click
 * edits it with the editor of its type where the note's Profile does not
 * replace the key, and toggles a checkbox. Enter or leaving the field
 * writes it, creating the note where the Item has none; Escape drops it.
 * The click stops at the cell, so the gesture of the row or the block that
 * holds the view does not run.
 */
export function VaultEditCell(props: VaultCellProps) {
  const { notes, itemKey, name, host } = props;
  const value = useVaultValue(props);
  const current = value.note ? value.value : null;
  const type = useVaultType(notes, name, current);
  const managed = useVaultManaged(props) && value.note;
  const [draft, setDraft] = useState<VaultDraft | null>(null);
  // Set when Enter or Escape ends the edit, so the blur that follows the
  // field leaving the page does not end it again.
  const ended = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const editing = draft !== null;
  useEffect(() => {
    if (editing) input.current?.focus();
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
  const end = (commit: boolean, edited: VaultDraft) => {
    if (ended.current) return;
    ended.current = true;
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
  return (
    <div
      data-query-vault-cell=""
      data-query-vault-name={name}
      className={cn(
        "zt:flex zt:min-w-0 zt:items-center zt:gap-1",
        editable && draft === null && !checkbox && "zt:cursor-text",
      )}
      onClick={(event) => {
        event.stopPropagation();
        if (!editable || draft !== null) return;
        // A checkbox of a row with no note toggles on, creating the note.
        if (!checkbox) begin();
        else if (!value.note) void write(true);
      }}
    >
      {draft === null ? (
        <>
          {!value.note ? (
            <VaultCellContent value={value} />
          ) : checkbox ? (
            <input
              data-query-vault-checkbox=""
              type="checkbox"
              className="task-list-item-checkbox zt:m-0"
              aria-label={m.query_view_vault_edit({ name })}
              checked={current === true}
              disabled={!editable}
              onChange={() => void write(current !== true)}
            />
          ) : type === "multitext" ? (
            <span
              data-query-vault={vaultState(value)}
              className="zt:flex zt:min-w-0 zt:flex-wrap zt:gap-1"
            >
              <VaultChips items={listItems(current)} />
            </span>
          ) : (
            <VaultCellContent value={value} />
          )}
          {managed && (
            <span
              data-query-vault-managed=""
              className="zt:ms-auto zt:flex zt:shrink-0 zt:text-(--text-faint)"
              aria-label={m.query_view_vault_managed()}
              title={m.query_view_vault_managed()}
            >
              <Icon name="lock" size="var(--icon-xs)" />
            </span>
          )}
        </>
      ) : (
        <VaultEditor
          type={type}
          name={name}
          draft={draft}
          onDraft={setDraft}
          onEnd={end}
          inputRef={input}
        />
      )}
    </div>
  );
}
