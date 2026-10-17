// The editor of a vault property in the Table, by the type the property
// takes: text, a number, a date, a list as chips, or a checkbox, which the
// cell toggles without entering edit. A date and time edits as text, so a
// value keeps the form it is stored in. Each writes the value as the
// Properties panel does: a number, a boolean, a `YYYY-MM-DD` date, a list
// of strings, and no value for a cleared field.
//
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import type { KeyboardEvent, RefObject } from "react";

import { valueText } from "@zotlit/item-query";
import type { ProjectionJson } from "@zotlit/item-query";

import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";

import type { VaultPropertyType } from "./table-notes";

/** What an edit holds: the field's text, and a list's items. */
export interface VaultDraft {
  readonly text: string;
  readonly items: readonly string[];
}

/** The items of a list value: one for a lone value, none for no value. */
export function listItems(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.flatMap((item) =>
    item === null || item === undefined
      ? []
      : [valueText(item as ProjectionJson)],
  );
}

/** The draft an edit of `value` starts from. */
export function draftOf(type: VaultPropertyType, value: unknown): VaultDraft {
  if (type === "multitext") return { text: "", items: listItems(value) };
  return { text: valueText(value as ProjectionJson), items: [] };
}

/**
 * The value `draft` writes: no value for a cleared field, and `undefined`
 * where it holds no value of the type, so nothing is written.
 */
export function valueOf(type: VaultPropertyType, draft: VaultDraft): unknown {
  if (type === "multitext") {
    const items = withPending(draft).items;
    return items.length === 0 ? null : items;
  }
  const text = type === "number" ? draft.text.trim() : draft.text;
  if (text === "") return null;
  if (type === "number") {
    const number = Number(text);
    return Number.isFinite(number) ? number : undefined;
  }
  return text;
}

/** The draft with its field's text added to the list as one item. */
function withPending(draft: VaultDraft): VaultDraft {
  const text = draft.text.trim();
  return text === "" ? draft : { text: "", items: [...draft.items, text] };
}

/** A list's items as chips, each with a remove button where `onRemove` is given. */
export function VaultChips({
  items,
  onRemove,
}: {
  items: readonly string[];
  onRemove?: (at: number) => void;
}) {
  return (
    <>
      {items.map((item, at) => (
        <span
          // Items may repeat, so the place keys each.
          key={at}
          data-query-vault-chip={item}
          className="multi-select-pill zt:min-w-0"
        >
          <span className="multi-select-pill-content zt:truncate">{item}</span>
          {onRemove && (
            <IconButton
              icon="x"
              data-query-vault-chip-remove=""
              className="multi-select-pill-remove-button"
              aria-label={m.query_view_vault_remove_item({ item })}
              onClick={() => onRemove(at)}
            />
          )}
        </span>
      ))}
    </>
  );
}

export interface VaultEditorProps {
  readonly type: VaultPropertyType;
  readonly name: string;
  readonly draft: VaultDraft;
  readonly onDraft: (draft: VaultDraft) => void;
  /**
   * End the edit, writing it or dropping it, on Enter or Escape. Focus that
   * leaves the editor is the cell's to tell.
   */
  readonly onEnd: (commit: boolean, draft: VaultDraft) => void;
  readonly inputRef: RefObject<HTMLInputElement | null>;
}

/** The field a vault property edits in, by its type; a checkbox has none. */
export function VaultEditor({
  type,
  name,
  draft,
  onDraft,
  onEnd,
  inputRef,
}: VaultEditorProps) {
  const list = type === "multitext";
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      // In a list, Enter adds the typed item; on an empty field it ends.
      if (list && draft.text.trim() !== "") onDraft(withPending(draft));
      else onEnd(true, draft);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onEnd(false, draft);
    }
  };
  const field = (
    <input
      data-query-vault-input=""
      type={type === "date" ? "date" : "text"}
      inputMode={type === "number" ? "decimal" : undefined}
      className="zt:w-full zt:min-w-0"
      aria-label={m.query_view_vault_edit({ name })}
      value={draft.text}
      ref={inputRef}
      onInput={(event) =>
        onDraft({ ...draft, text: event.currentTarget.value })
      }
      onKeyDown={onKeyDown}
    />
  );
  if (!list) return field;
  return (
    <div className="zt:flex zt:min-w-0 zt:flex-1 zt:flex-wrap zt:items-center zt:gap-1">
      <VaultChips
        items={draft.items}
        onRemove={(at) => {
          onDraft({ ...draft, items: draft.items.filter((_, i) => i !== at) });
          // The button leaves the page, so the edit takes the focus back.
          inputRef.current?.focus();
        }}
      />
      <div className="zt:min-w-16 zt:flex-1">{field}</div>
    </div>
  );
}
