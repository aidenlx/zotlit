// The editor of a vault property in the Table, by the type the property
// takes, drawn over the cell as a Bases cell edits: text that wraps as it
// grows, a number, a native date or date and time field, or a list as pills
// with a field after them; a checkbox the cell toggles without entering
// edit. Each writes the value as the Properties panel does: a number, a
// boolean, a `YYYY-MM-DD` date, a `YYYY-MM-DDTHH:mm:ss` date and time, a list
// of strings, and no value for a cleared field. Text, lists and tags suggest
// the values the vault holds for the property.
//
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import {
  AbstractInputSuggest,
  prepareSimpleSearch,
  renderMatches,
} from "obsidian";
import type { App } from "obsidian";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, RefObject } from "react";

import { valueText } from "@zotlit/item-query";
import type { ProjectionJson } from "@zotlit/item-query";

import { IconButton } from "@/components/obsidian/icon-button";
import { useObsidianApp } from "@/lib/app-context";
import * as m from "@/lib/i18n/generated/messages";
import { cn, tooltipAttrs } from "@/lib/utils";

import { LIST_TYPES } from "./table-notes";
import type { VaultPropertyType } from "./table-notes";
import { dateInputValue, dateValue, tagText } from "./vault-value";

/** What an edit holds: the field's text, and a list's items. */
export interface VaultDraft {
  readonly text: string;
  readonly items: readonly string[];
}

/**
 * Where focus goes once an edit ends: back to the cell, after Enter or
 * Escape; to the next or the previous vault cell of the row, after Tab or
 * Shift+Tab; or where it went, when it left the editor.
 */
export type VaultEditEnd = "stay" | "next" | "previous" | "leave";

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

const isDate = (type: VaultPropertyType): type is "date" | "datetime" =>
  type === "date" || type === "datetime";

/** The draft an edit of `value` starts from. */
export function draftOf(type: VaultPropertyType, value: unknown): VaultDraft {
  if (LIST_TYPES.has(type)) return { text: "", items: listItems(value) };
  const text = valueText(value as ProjectionJson);
  if (isDate(type)) return { text: dateInputValue(type, text), items: [] };
  return { text, items: [] };
}

/**
 * The value `draft` writes: no value for a cleared field, and `undefined`
 * where it holds no value of the type, so nothing is written.
 */
export function valueOf(type: VaultPropertyType, draft: VaultDraft): unknown {
  if (LIST_TYPES.has(type)) {
    const items = withPending(draft).items;
    return items.length === 0 ? null : items;
  }
  if (isDate(type)) return dateValue(type, draft.text);
  const text = type === "number" ? draft.text.trim() : draft.text.trimEnd();
  if (text === "") return null;
  if (type === "number") {
    const number = Number(text);
    return Number.isFinite(number) ? number : undefined;
  }
  return text;
}

/**
 * The draft with its field's text added to the list as one item; an item
 * the list holds already is not added again.
 */
function withPending(draft: VaultDraft): VaultDraft {
  const text = draft.text.trim();
  if (text === "") return draft;
  if (draft.items.includes(text)) return { ...draft, text: "" };
  return { text: "", items: [...draft.items, text] };
}

/**
 * The values to suggest for `query`: the typed text first, so Enter keeps
 * what was typed until another value is picked, then each value that
 * matches it, less those in `taken`. Nothing is suggested before a key is
 * typed.
 */
export function suggestionsFor(
  values: readonly string[],
  query: string,
  taken: readonly string[] = [],
): string[] {
  const text = query.trim();
  if (text === "") return [];
  const search = prepareSimpleSearch(text);
  const matches = values.filter(
    (value) =>
      value !== text && !taken.includes(value) && search(value) !== null,
  );
  return taken.includes(text) ? matches : [text, ...matches];
}

/** Where a {@link ValueSuggest} reads its values and hands its pick. */
interface ValueSuggestSource {
  values(): readonly string[];
  /** The values the list holds already, which are no addition. */
  taken(): readonly string[];
  pick(value: string): void;
}

/**
 * Obsidian's suggestion popup over a vault field, with the values the vault
 * holds for the property. A text field is a `<textarea>`, which Obsidian's
 * suggest would read as a contenteditable, so it is told the field's value.
 */
class ValueSuggest extends AbstractInputSuggest<string> {
  readonly #source: ValueSuggestSource;
  readonly #field: HTMLInputElement | HTMLTextAreaElement;
  #query = "";

  constructor(
    app: App,
    field: HTMLInputElement | HTMLTextAreaElement,
    source: ValueSuggestSource,
  ) {
    super(app, field as HTMLInputElement);
    this.#field = field;
    this.#source = source;
  }

  override getValue(): string {
    return this.#field.value;
  }

  override setValue(value: string): void {
    this.#field.value = value;
  }

  protected override getSuggestions(query: string): string[] {
    this.#query = query.trim();
    return suggestionsFor(this.#source.values(), query, this.#source.taken());
  }

  override renderSuggestion(value: string, el: HTMLElement): void {
    renderMatches(
      el,
      value,
      prepareSimpleSearch(this.#query)(value)?.matches ?? null,
    );
  }

  override selectSuggestion(value: string): void {
    this.close();
    this.#source.pick(value);
  }
}

/** Attach a {@link ValueSuggest} to `field` while it is on the page. */
function useValueSuggest(
  field: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  source: ValueSuggestSource | null,
) {
  const app = useObsidianApp();
  // The latest source, so the popup reads the draft it was opened over.
  const latest = useRef(source);
  latest.current = source;
  const suggests = source !== null;
  useEffect(() => {
    const el = field.current;
    if (!el || !suggests) return;
    const suggest = new ValueSuggest(app, el, {
      values: () => latest.current?.values() ?? [],
      taken: () => latest.current?.taken() ?? [],
      pick: (value) => latest.current?.pick(value),
    });
    return () => suggest.close();
  }, [app, field, suggests]);
}

/**
 * A field in a cell: no chrome of its own, only the cell's ring, in the
 * cell's text and padding, as a Bases cell edits. `vault-cell.css` rolls
 * Obsidian's own field rules back, so these utilities draw it.
 */
const FIELD =
  "zt:relative zt:block zt:w-full zt:min-w-0 zt:bg-transparent zt:px-2 zt:py-1 zt:text-(--text-normal) zt:outline-none";

export interface VaultEditorProps {
  readonly type: VaultPropertyType;
  /** The element that names the field, so the name shows no tooltip. */
  readonly labelId: string;
  readonly draft: VaultDraft;
  readonly onDraft: (draft: VaultDraft) => void;
  /**
   * End the edit, writing it or dropping it. Focus that leaves the editor
   * is the cell's to tell.
   */
  readonly onEnd: (
    commit: boolean,
    draft: VaultDraft,
    how: VaultEditEnd,
  ) => void;
  /** The values the vault holds for the property, to suggest. */
  readonly suggestions: () => readonly string[];
}

/** Tab and Shift+Tab end the edit from any field, and move on. */
function tabEnd(
  event: KeyboardEvent,
  end: (how: VaultEditEnd) => void,
): boolean {
  if (event.key !== "Tab") return false;
  event.preventDefault();
  end(event.shiftKey ? "previous" : "next");
  return true;
}

/** The field a vault property edits in, by its type; a checkbox has none. */
export function VaultEditor(props: VaultEditorProps) {
  if (LIST_TYPES.has(props.type)) return <ListEditor {...props} />;
  return <FieldEditor {...props} />;
}

/** Text, a number, a date, or a date and time. */
function FieldEditor({
  type,
  labelId,
  draft,
  onDraft,
  onEnd,
  suggestions,
}: VaultEditorProps) {
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.focus();
    // Entering edit puts the caret at the end, as a Bases cell does.
    if (el.type === "text" || el.type === "textarea")
      el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const text = type === "text";
  useValueSuggest(
    field,
    text
      ? {
          values: suggestions,
          taken: () => [],
          pick: (value) => onEnd(true, { ...draft, text: value }, "stay"),
        }
      : null,
  );
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    // A key the suggestion popup took is its own.
    if (event.defaultPrevented) return;
    if (tabEnd(event, (how) => onEnd(true, draft, how))) return;
    // Shift+Enter starts a new line of text.
    if (event.key === "Enter" && !(text && event.shiftKey)) {
      event.preventDefault();
      onEnd(true, draft, "stay");
    } else if (event.key === "Escape") {
      event.preventDefault();
      onEnd(false, draft, "stay");
    }
  };
  const shared = {
    "data-query-vault-input": "",
    "aria-labelledby": labelId,
    value: draft.text,
    onInput: (event: { currentTarget: { value: string } }) =>
      onDraft({ ...draft, text: event.currentTarget.value }),
    onKeyDown,
  };
  if (text)
    return (
      <textarea
        {...shared}
        ref={field}
        rows={1}
        className={cn(
          FIELD,
          "zt:field-sizing-content zt:max-h-75 zt:resize-none zt:overflow-y-auto zt:whitespace-pre-wrap",
        )}
      />
    );
  if (isDate(type))
    return (
      <input
        {...shared}
        ref={field}
        type={type === "date" ? "date" : "datetime-local"}
        max={type === "date" ? "9999-12-31" : "9999-12-31T23:59:59"}
        step={type === "datetime" ? 1 : undefined}
        // Obsidian places the picker's icon at the start of the field.
        className={cn(
          FIELD,
          "zt:h-(--bases-table-row-height) zt:ps-7 zt:tabular-nums",
        )}
      />
    );
  return (
    <input
      {...shared}
      ref={field}
      type="text"
      inputMode={type === "number" ? "decimal" : undefined}
      className={cn(
        FIELD,
        "zt:h-(--bases-table-row-height)",
        type === "number" && "zt:text-end zt:tabular-nums",
      )}
    />
  );
}

/** A list, aliases or tags: pills, then a field that adds one. */
function ListEditor({
  type,
  labelId,
  draft,
  onDraft,
  onEnd,
  suggestions,
}: VaultEditorProps) {
  const field = useRef<HTMLInputElement>(null);
  const pills = useRef<(HTMLElement | null)[]>([]);
  /** The pill to focus once the list renders again; -1 for the field. */
  const focusAfter = useRef<number | null>(null);
  useLayoutEffect(() => field.current?.focus(), []);
  useLayoutEffect(() => {
    const at = focusAfter.current;
    if (at === null) return;
    focusAfter.current = null;
    (at < 0 ? field.current : pills.current[at])?.focus();
  });
  const add = (text: string) => onDraft(withPending({ ...draft, text }));
  useValueSuggest(field, {
    values: suggestions,
    taken: () => draft.items,
    pick: add,
  });
  const focusPill = (at: number) => {
    if (at < 0) return;
    if (at >= draft.items.length) field.current?.focus();
    else pills.current[at]?.focus();
  };
  const remove = (at: number) => {
    focusAfter.current = at - 1;
    onDraft({ ...draft, items: draft.items.filter((_, i) => i !== at) });
  };
  const end = (how: VaultEditEnd) => onEnd(true, draft, how);
  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.defaultPrevented) return;
    if (tabEnd(event, end)) return;
    const el = event.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    switch (event.key) {
      case "Enter":
        event.preventDefault();
        // Enter adds the typed item; on an empty field it ends the edit.
        if (draft.text.trim() !== "") add(draft.text);
        else end("stay");
        break;
      case "Escape":
        // As in Bases, Escape leaves the list with what was typed added.
        event.preventDefault();
        end("stay");
        break;
      case "Backspace":
      case "ArrowLeft":
        if (draft.text !== "" && !(event.key === "ArrowLeft" && atStart))
          return;
        event.preventDefault();
        focusPill(draft.items.length - 1);
        break;
    }
  };
  const onPillKey = (event: KeyboardEvent<HTMLElement>, at: number) => {
    event.stopPropagation();
    if (tabEnd(event, end)) return;
    const moves: Record<string, () => void> = {
      Backspace: () => remove(at),
      Delete: () => remove(at),
      ArrowLeft: () => focusPill(at - 1),
      ArrowRight: () => focusPill(at + 1),
      ArrowUp: () => focusPill(0),
      ArrowDown: () => field.current?.focus(),
      Escape: () => field.current?.focus(),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  };
  return (
    <div className="zt:flex zt:min-h-(--bases-table-row-height) zt:flex-wrap zt:items-center zt:gap-(--size-2-3) zt:px-2 zt:py-1">
      {draft.items.map((item, at) => (
        <span
          // Items may repeat, so the place keys each.
          key={at}
          ref={(el) => {
            pills.current[at] = el;
          }}
          tabIndex={-1}
          data-query-vault-chip={item}
          className={cn(PILL, type === "tags" && TAG)}
          onKeyDown={(event) => onPillKey(event, at)}
        >
          <span className="zt:min-w-0 zt:break-words">
            {type === "tags" ? tagText(item) : item}
          </span>
          <IconButton
            icon="x"
            data-query-vault-chip-remove=""
            className="zt:p-0"
            {...tooltipAttrs(m.query_view_vault_remove_item({ item }))}
            // A press keeps focus in the editor, so the edit goes on.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              focusAfter.current = -1;
              onDraft({
                ...draft,
                items: draft.items.filter((_, i) => i !== at),
              });
            }}
          />
        </span>
      ))}
      <input
        data-query-vault-input=""
        type="text"
        ref={field}
        aria-labelledby={labelId}
        value={draft.text}
        className={cn(FIELD, "zt:w-auto zt:min-w-16 zt:flex-1 zt:p-0")}
        onInput={(event) =>
          onDraft({ ...draft, text: event.currentTarget.value })
        }
        onKeyDown={onFieldKey}
      />
    </div>
  );
}

/**
 * One item of a list, as a Bases list cell shows it: plain text, parted from
 * the next by the gap, with a ring when the keyboard is on it.
 */
export const PILL =
  "zt:flex zt:max-w-full zt:min-w-0 zt:shrink-0 zt:items-center zt:gap-(--size-2-1) zt:rounded-(--pill-radius) zt:leading-(--line-height-tight) zt:outline-none zt:focus-visible:ring-1 zt:focus-visible:ring-(--background-modifier-border-focus)";

/** A tag: Obsidian's tag colours, as a Bases tag cell shows it. */
export const TAG =
  "zt:border-(length:--tag-border-width) zt:border-(--tag-border-color) zt:bg-(--tag-background) zt:px-(--tag-padding-x) zt:py-(--tag-padding-y) zt:leading-none zt:font-(--tag-weight) zt:text-(color:--tag-color) zt:hover:bg-(--tag-background-hover) zt:rounded-(--tag-radius)";
