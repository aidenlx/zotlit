// A vault property of one row, as each Layout shows it: the value of the
// frontmatter key on the Item's Literature Note, an empty cell where the note
// lacks the key or holds null, and a placeholder where the Item has no note
// to read it from. A cell reads again when the note's frontmatter changes,
// with no new run of the view's query.
//
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useSyncExternalStore,
} from "react";

import { valueText } from "@zotlit/item-query";
import type { ProjectionJson } from "@zotlit/item-query";

import * as m from "@/lib/i18n/generated/messages";

import type { LiteratureNotes, VaultHost, VaultValue } from "./table-notes";

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
