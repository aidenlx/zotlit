// The editor of a vault property in the Table, by the type the property
// takes, drawn over the cell as a Bases cell edits: text that wraps as it
// grows, a number, a native date or date and time field, or a list as pills
// with a field after them; a checkbox the cell toggles without entering
// edit. Each writes the value as the Properties panel does: a number, a
// boolean, a `YYYY-MM-DD` date, a `YYYY-MM-DDTHH:mm:ss` date and time, a list
// of strings, and no value for a cleared field. Text, lists and tags suggest
// the values the vault holds for the property as their edit starts, as a
// Bases cell does; aliases suggest none, as in Bases.
//
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import {
  AbstractInputSuggest,
  prepareFuzzySearch,
  renderMatches,
} from "obsidian";
import type { App } from "obsidian";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  HTMLAttributes,
  KeyboardEvent,
  ReactNode,
  Ref,
  RefObject,
} from "react";

import { valueText } from "@zotlit/item-query";
import type { ProjectionJson } from "@zotlit/item-query";

import { Icon } from "@/components/obsidian/icon";
import { useObsidianApp } from "@/lib/app-context";
import * as m from "@/lib/i18n/generated/messages";
import { clearSuggestHighlight } from "@/lib/obsidian-private/suggest-highlight";
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

const collator = new Intl.Collator(undefined, {
  usage: "sort",
  sensitivity: "base",
  numeric: true,
});

/** The order Obsidian lists vault values and tags in. */
const byName = (a: string, b: string) => collator.compare(a, b);

/**
 * The values to suggest for `query`, less those in `taken`, as a Bases cell
 * suggests them: every value, in order, before a key is typed; then those
 * that match it, the best match first. The typed text itself is no
 * suggestion: Shift+Enter keeps it.
 */
export function suggestionsFor(
  values: readonly string[],
  query: string,
  taken: readonly string[] = [],
): string[] {
  const listed = [...new Set(values)]
    .filter((value) => !taken.includes(value))
    .sort(byName);
  const text = query.trim();
  if (text === "") return listed;
  const search = prepareFuzzySearch(text);
  return listed
    .flatMap((value) => {
      const match = search(value);
      return match ? [{ value, score: match.score }] : [];
    })
    .sort((a, b) => b.score - a.score)
    .map(({ value }) => value);
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
 * As in a Bases cell, nothing is highlighted before a key is typed, so
 * Enter takes no value until one is chosen, and Shift+Enter takes the typed
 * text over the highlighted value.
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
    // Obsidian's own look of a property value suggest: its smaller rows.
    this.suggestEl.classList.add("mod-property-value");
    this.scope.register(["Shift"], "Enter", (event) => {
      if (event.isComposing) return;
      this.selectSuggestion(this.getValue());
      return false;
    });
  }

  override open(): void {
    super.open();
    if (this.getValue() === "") clearSuggestHighlight(this);
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
    // A long value truncates within the popover, as a Bases cell's does.
    el.classList.add("mod-nowrap");
    renderMatches(
      el,
      value,
      this.#query === ""
        ? null
        : (prepareFuzzySearch(this.#query)(value)?.matches ?? null),
    );
  }

  override selectSuggestion(value: string): void {
    this.close();
    this.#source.pick(value);
  }
}

/**
 * Show the suggestions of the {@link ValueSuggest} on `field` again, as
 * Obsidian shows them when the field takes focus: if the field holds focus.
 */
function showAgain(field: HTMLElement | null) {
  if (field && field.ownerDocument.activeElement === field)
    field.dispatchEvent(new FocusEvent("focus"));
}

/**
 * Attach a {@link ValueSuggest} to `field` while it is on the page. The
 * editor focuses its field as it opens, before the suggest listens, so the
 * suggestions show then, as they show on focus.
 */
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
    showAgain(el);
    return () => suggest.close();
  }, [app, field, suggests]);
}

/**
 * The box a line of a vault cell sits in, the same at rest and in every
 * editor: the cell's padding at its start and end, and above and below the
 * half of the row the line leaves, so a line of text is a row tall and
 * its first line sits where a Bases cell shows it, and stays there when an
 * edit opens and as text wraps below it. A row of chips takes the row's
 * height as its line, and so no padding above it.
 */
export const LINE =
  "zt:px-2 zt:py-[calc((var(--bases-table-row-height)-1lh)/2)]";

/** The line a row of chips flows on, at rest and in the editor alike. */
export const CHIPS = cn(LINE, "zt:leading-(--bases-table-row-height)");

/**
 * A field in a cell: no chrome of its own, only the cell's ring, in the
 * cell's text and {@link LINE}, as a Bases cell edits; a date shows at rest
 * in one too. `vault-cell.css` rolls Obsidian's own field rules back, so
 * these utilities draw it.
 */
export const FIELD = cn(
  "zt:relative zt:block zt:w-full zt:min-w-0 zt:bg-transparent zt:text-(--text-normal) zt:outline-none",
  LINE,
);

/** A field one line tall: a number, a date, or a date and time. */
export const ONE_LINE = "zt:h-(--bases-table-row-height)";

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
        // Obsidian places the picker's icon at the start of the field.
        className={cn(FIELD, ONE_LINE, "zt:ps-7 zt:tabular-nums")}
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
        ONE_LINE,
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
  /** Whether a value was just picked, so the suggestions show again. */
  const picked = useRef(false);
  useLayoutEffect(() => {
    if (!picked.current) return;
    picked.current = false;
    showAgain(field.current);
  });
  // As in Bases, an alias suggests no value.
  useValueSuggest(
    field,
    type === "aliases"
      ? null
      : {
          values: suggestions,
          taken: () => draft.items,
          // As in Bases, the rest show again once one is added.
          pick: (value) => {
            picked.current = true;
            add(value);
          },
        },
  );
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
    // The pills flow as inline boxes on lines a row tall, as they do at
    // rest, so the editor that grows over the rows below ends on a row's
    // edge, never across the pills of the next row, and a pill sits where
    // it sits at rest. A press on the space between them goes to the field.
    <div
      className={cn(CHIPS, "zt:whitespace-normal")}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        field.current?.focus();
      }}
    >
      {draft.items.map((item, at) => (
        <VaultChip
          // Items may repeat, so the place keys each.
          key={at}
          item={item}
          tags={type === "tags"}
          chipRef={(el) => {
            pills.current[at] = el;
          }}
          tabIndex={-1}
          data-query-vault-chip={item}
          onKeyDown={(event) => onPillKey(event, at)}
        >
          {/* Bare rather than an `IconButton`: Obsidian's `clickable-icon`
              box would pad the x past the line and make the chip taller in
              the editor than at rest. The x is as tall as the text, so the
              chip keeps its height; the keys reach it through the pill. */}
          <span
            role="button"
            data-query-vault-chip-remove=""
            className="zt:flex zt:shrink-0 zt:cursor-(--cursor) zt:text-(--text-faint) zt:hover:text-(--text-normal)"
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
          >
            <Icon name="x" size="1em" />
          </span>
        </VaultChip>
      ))}
      <input
        data-query-vault-input=""
        type="text"
        ref={field}
        aria-labelledby={labelId}
        value={draft.text}
        className={cn(
          FIELD,
          "zt:inline-block zt:[field-sizing:content] zt:w-auto zt:max-w-full zt:min-w-16 zt:p-0",
        )}
        onInput={(event) =>
          onDraft({ ...draft, text: event.currentTarget.value })
        }
        onKeyDown={onFieldKey}
      />
    </div>
  );
}

/**
 * One item of a list, with a ring when the keyboard is on it. A Bases list
 * cell parts its items by the gap alone, so "thesis hypertext history" reads
 * as one run of words; each item here is a quiet chip of its own, at rest and
 * in the editor alike, on the line of {@link CHIPS}. A tag takes {@link TAG}
 * over it instead.
 */
export const PILL =
  "zt:me-(--size-2-2) zt:inline-flex zt:max-w-full zt:min-w-0 zt:items-center zt:gap-(--size-2-1) zt:rounded-(--radius-s) zt:bg-(--background-modifier-hover) zt:px-(--size-2-2) zt:py-px zt:leading-(--line-height-tight) zt:outline-none zt:focus-visible:ring-1 zt:focus-visible:ring-(--background-modifier-border-focus)";

/** A tag: Obsidian's tag colours, as a Bases tag cell shows it. */
export const TAG =
  "zt:border-(length:--tag-border-width) zt:border-(--tag-border-color) zt:bg-(--tag-background) zt:px-(--tag-padding-x) zt:py-(--tag-padding-y) zt:leading-none zt:font-(--tag-weight) zt:text-(color:--tag-color) zt:hover:bg-(--tag-background-hover) zt:rounded-(--tag-radius)";

/** Whether the text of `el` is wider than the box that clips it. */
function useTruncated(el: RefObject<HTMLElement | null>, text: string) {
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const label = el.current;
    // The observer of the window the cell stands in, which a popout changes.
    const Observer = label?.ownerDocument.defaultView?.ResizeObserver;
    if (!label || !Observer) return;
    const observer = new Observer(() =>
      setTruncated(label.scrollWidth > label.clientWidth),
    );
    observer.observe(label);
    return () => observer.disconnect();
  }, [el, text]);
  return truncated;
}

/**
 * An item of a list as a chip, at rest and in the editor alike. An item too
 * long for the column truncates with an ellipsis, before the x of the
 * editor, so a chip stays one line; a truncated chip shows the whole item
 * as its tooltip.
 */
export function VaultChip({
  item,
  tags,
  chipRef,
  children,
  ...attrs
}: {
  readonly item: string;
  readonly tags: boolean;
  readonly chipRef?: Ref<HTMLSpanElement>;
  /** What follows the item in the chip: the editor's x. */
  readonly children?: ReactNode;
} & Omit<HTMLAttributes<HTMLSpanElement>, "className" | "children"> & {
    readonly "data-query-vault-chip"?: string;
  }) {
  const label = useRef<HTMLSpanElement>(null);
  const text = tags ? tagText(item) : item;
  const truncated = useTruncated(label, text);
  return (
    <span
      {...attrs}
      ref={chipRef}
      className={cn(PILL, tags && TAG)}
      {...(truncated ? tooltipAttrs(text) : {})}
    >
      <span ref={label} className="zt:min-w-0 zt:truncate">
        {text}
      </span>
      {children}
    </span>
  );
}
