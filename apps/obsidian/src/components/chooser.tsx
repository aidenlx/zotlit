// The Chooser: an anchored popover holding a search field and tickable rows.
//
// The popup is a native popover in the browser's top layer, so the platform
// owns showing it, the outside click and Escape; CSS anchor positioning places
// it and flips it, so nothing here measures or moves it. It wears no Obsidian
// menu class and takes menu chrome as CSS variables instead.
//
// The keyboard is Obsidian's: one Scope per mounted Chooser, parented to the
// app scope and pushed while the popup stands, so a key it never registered
// reaches Obsidian's own hotkeys. DOM focus stays in the search field the whole
// time — the highlight is row state, a scroll-into-view and an active
// descendant, not real focus.
//
// @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md

import { Scope, prepareFuzzySearch } from "obsidian";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
  Ref,
  RefObject,
} from "react";

import { Icon } from "@/components/obsidian/icon";
import { SearchInput } from "@/components/obsidian/search-input";
import { useObsidianApp } from "@/lib/app-context";
import { registerKeymap } from "@/lib/disposables";
import { themeHook } from "@/lib/theme-hooks";
import { cn } from "@/lib/utils";

import {
  clampedHighlight,
  movedHighlight,
  rehomedHighlight,
  toggledValues,
  visibleRows,
} from "./chooser-logic";
import type { ChooserMove, ChooserRow } from "./chooser-logic";
import "./chooser.css";

// The decision logic is a sibling file; this module is the entry, so its
// surface is reachable from here too.
export {
  clampedHighlight,
  movedHighlight,
  rehomedHighlight,
  toggledValues,
  visibleRows,
};
export type { ChooserMatcher, ChooserMove, ChooserRow } from "./chooser-logic";

/** Rows a page step covers when the list is too empty to measure one. */
const FALLBACK_PAGE_SIZE = 10;

interface ChooserState {
  selected: readonly string[];
  onValueChange: (next: string[]) => void;
  query: string;
  setQuery: (next: string) => void;
  /** What the browser last reported through the popup's toggle event. */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The `--zt-chooser-*` identifier binding the popup to its trigger. */
  anchorName: string;
  popupId: string;
  listId: string;
  /** The row box, which a page step measures itself against. */
  listRef: RefObject<HTMLDivElement | null>;
  /** The rows on screen now, as the list part last published them. */
  rows: readonly ChooserRow[];
  publishRows: (rows: readonly ChooserRow[]) => void;
  /** Index into {@link rows}; out-of-range until the list publishes. */
  highlight: number;
  setHighlight: (index: number) => void;
  /** The `id` of the row at an index, for `aria-activedescendant`. */
  optionId: (index: number) => string;
  /** The `id` the highlight points at, or `null` while it points at no row. */
  activeOptionId: string | null;
}

const ChooserContext = createContext<ChooserState | null>(null);

function useChooser(): ChooserState {
  const state = useContext(ChooserContext);
  if (!state) throw new Error("Chooser part rendered outside a Chooser");
  return state;
}

/** What a row needs from the list it is drawn in. */
interface ChooserListState {
  /** Where each visible row sits, so a row can name its own index. */
  indexOf: ReadonlyMap<string, number>;
  rows: readonly ChooserRow[];
  /** The highlighted index, already clamped to the rows on screen. */
  active: number;
  optionId: (index: number) => string;
}

const ChooserListContext = createContext<ChooserListState | null>(null);

function useChooserList(): ChooserListState {
  const state = useContext(ChooserListContext);
  if (!state) throw new Error("Chooser.Item rendered outside a Chooser.List");
  return state;
}

/**
 * Whether a keystroke belongs to an in-flight IME composition. Obsidian's
 * keymap dispatcher offers no such guard, so every handler below asks for
 * itself — the spec makes that each handler's own job. `keyCode` 229 is the
 * composition keystroke an IME reports before `isComposing` turns true.
 */
function composing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

/**
 * How many rows a Page Up or Page Down step covers: as many whole rows as the
 * scroll box shows. Read off the DOM at the moment the key fires, because a
 * themed row height and a flipped popup both change it.
 */
function pageSizeOf(list: HTMLElement | null): number {
  const row = list?.querySelector<HTMLElement>('[role="option"]');
  if (!list || !row || row.offsetHeight === 0) return FALLBACK_PAGE_SIZE;
  return Math.max(1, Math.floor(list.clientHeight / row.offsetHeight));
}

/**
 * An anchor name is a global identifier, so each mounted Chooser takes one of
 * its own rather than accepting one from its caller.
 */
let chooserSequence = 0;

/**
 * The selection API is narrower than the Chooser's parts list on purpose: no
 * `multiple` flag and no `isItemEqualToValue`. Every row here ticks alongside
 * the others and every consumer holds plain strings, so neither knob has a
 * caller to serve — see policies/simplicity.md.
 */
export interface ChooserProps {
  /** The selected values. The Chooser reads them and stores none of its own. */
  value: readonly string[];
  /** Called with the whole selection a tick leaves behind. */
  onValueChange: (next: string[]) => void;
  children: ReactNode;
}

export function Chooser({ value, onValueChange, children }: ChooserProps) {
  const app = useObsidianApp();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [popupId] = useState(() => `zt-chooser-${(chooserSequence += 1)}`);
  const [rows, setRows] = useState<readonly ChooserRow[]>([]);
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  /**
   * What the key handlers read. They are registered once, so a closure would
   * hand them the render they were built in; this ref hands them the render
   * that is on screen.
   *
   * It is written while rendering rather than from an effect on purpose: a key
   * arrives through Obsidian's own listener, outside anything that flushes
   * effects first, and an effect that has not run yet would answer with the
   * row the highlight stood on one keystroke ago. Preact renders
   * synchronously, so the write lands with the render it describes.
   */
  const latest = useRef({ rows, highlight, selected: value, onValueChange });
  latest.current = { rows, highlight, selected: value, onValueChange };

  /**
   * A rebuilt row set re-homes the highlight rather than keeping its index: a
   * tick rebuilds the list around the same rows and the highlight stays where
   * it stood, while a narrowed query takes its row away and the highlight
   * starts over.
   */
  const publishRows = useCallback((next: readonly ChooserRow[]) => {
    const { rows: previous, highlight: at } = latest.current;
    const held = previous[clampedHighlight(at, previous.length)]?.value ?? null;
    setRows(next);
    setHighlight(rehomedHighlight(held, next));
  }, []);

  const optionId = useCallback(
    (index: number) => `${popupId}-option-${index}`,
    [popupId],
  );
  const active = clampedHighlight(highlight, rows.length);

  /**
   * One scope per mounted Chooser, parented to the app scope so every key it
   * leaves alone — Escape included, which stays the platform's — reaches
   * Obsidian's own hotkeys. The parent cannot be changed afterwards, so the
   * scope is built once with the root rather than rebuilt per open.
   */
  const [scope] = useState(() => new Scope(app.scope));

  // Layout effects throughout this component, not passive ones. A passive
  // effect is flushed on the browser's own schedule, and a key arrives through
  // Obsidian's listener without waiting for it: the scope would be pushed after
  // the first keystroke it was meant to catch, and the rows the handlers read
  // would be a keystroke behind. Committing synchronously is what keeps the
  // keyboard and the rows on screen describing the same moment.
  useLayoutEffect(() => {
    const move = (step: ChooserMove) => (event: KeyboardEvent) => {
      if (composing(event)) return;
      const { rows: shown, highlight: at } = latest.current;
      setHighlight(
        movedHighlight(at, step, {
          count: shown.length,
          pageSize: pageSizeOf(listRef.current),
        }),
      );
      return false;
    };
    const tick = (event: KeyboardEvent) => {
      if (composing(event)) return;
      const {
        rows: shown,
        highlight: at,
        selected,
        onValueChange: emit,
      } = latest.current;
      const row = shown[clampedHighlight(at, shown.length)];
      if (!row || row.disabled) return;
      emit(toggledValues(selected, row.value));
      return false;
    };
    // Escape is absent on purpose: the popover's own light dismiss closes it,
    // and a handler here returning `false` would preventDefault and suppress
    // that. Ctrl-P and Ctrl-N repeat the arrows, the way every Obsidian list
    // does.
    const bound = [
      registerKeymap(scope, [], "ArrowUp", move("previous")),
      registerKeymap(scope, [], "ArrowDown", move("next")),
      registerKeymap(scope, [], "PageUp", move("page-up")),
      registerKeymap(scope, [], "PageDown", move("page-down")),
      registerKeymap(scope, [], "Home", move("first")),
      registerKeymap(scope, [], "End", move("last")),
      registerKeymap(scope, ["Ctrl"], "p", move("previous")),
      registerKeymap(scope, ["Ctrl"], "n", move("next")),
      registerKeymap(scope, [], "Enter", tick),
    ];
    return () => {
      for (const handler of bound) handler[Symbol.dispose]();
    };
  }, [scope]);

  /**
   * Pushed and popped on the popup's own toggle event, so the Chooser holds
   * the keyboard exactly while it is on screen and a closed one is inert.
   */
  useLayoutEffect(() => {
    if (!open) return;
    setHighlight(0);
    app.keymap.pushScope(scope);
    return () => app.keymap.popScope(scope);
  }, [open, app, scope]);

  const state = useMemo<ChooserState>(
    () => ({
      selected: value,
      onValueChange,
      query,
      setQuery,
      open,
      setOpen,
      anchorName: `--${popupId}`,
      popupId,
      listId: `${popupId}-list`,
      listRef,
      rows,
      publishRows,
      highlight,
      setHighlight,
      optionId,
      activeOptionId: active < 0 ? null : optionId(active),
    }),
    [
      value,
      onValueChange,
      query,
      open,
      popupId,
      rows,
      publishRows,
      highlight,
      optionId,
      active,
    ],
  );

  return <ChooserContext value={state}>{children}</ChooserContext>;
}

export interface ChooserTriggerProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "popoverTarget" | "type"
> {
  ref?: Ref<HTMLButtonElement>;
}

/**
 * The control the popup hangs under. The popover target attribute makes the
 * browser the one that opens and closes it, which is what keeps a press while
 * the popup stands from reopening what the outside click just dismissed.
 *
 * It carries the anchor name and `data-open`, so the caller's own content
 * reads the open state through `zt:group-data-open:` rather than a prop.
 */
function Trigger({ className, style, ref, ...rest }: ChooserTriggerProps) {
  const { anchorName, popupId, open } = useChooser();
  return (
    <button
      ref={ref}
      type="button"
      popoverTarget={popupId}
      aria-expanded={open}
      data-open={open ? "" : undefined}
      {...rest}
      className={cn(
        "zt-chooser-trigger",
        "zt:group zt:[anchor-name:var(--zt-chooser-anchor)]",
        className,
      )}
      style={{ "--zt-chooser-anchor": anchorName, ...style } as CSSProperties}
    />
  );
}

export interface ChooserPopupProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "id" | "popover" | "onToggle"
> {
  ref?: Ref<HTMLDivElement>;
}

/**
 * The popup itself. `inset: auto` hands placement to the position area: the
 * popover user-agent rule pins all four edges, which would strand a flipped
 * popup at the top of the viewport instead of above its trigger.
 *
 * The display utility is gated on `:popover-open`. A closed popover is hidden
 * by the user-agent rule `[popover]:not(:popover-open) { display: none }`, and
 * an unconditional author-origin `display` outranks it — the popup then keeps
 * painting after it closes, dropping out of the top layer so the view behind
 * draws over it. It reads as a popup that will not close and has lost its
 * background.
 */
function Popup({ className, style, ref, ...rest }: ChooserPopupProps) {
  const { anchorName, popupId, setOpen } = useChooser();
  return (
    <div
      ref={ref}
      id={popupId}
      popover="auto"
      onToggle={(event) => setOpen(event.newState === "open")}
      {...rest}
      className={cn(
        themeHook.chooser,
        "zt:inset-auto zt:my-1 zt:max-h-75 zt:max-w-80 zt:min-w-50 zt:flex-col zt:[&:popover-open]:flex",
        "zt:border-(length:--menu-border-width) zt:border-(--menu-border-color) zt:bg-(--menu-background) zt:p-(--menu-padding) zt:text-foreground zt:shadow-(--menu-shadow)",
        "zt:rounded-(--menu-radius) zt:[corner-shape:var(--menu-corner-shape)]",
        "zt:[position-anchor:var(--zt-chooser-anchor)] zt:[position-area:block-end_span-inline-end] zt:[position-try-fallbacks:flip-block]",
        className,
      )}
      style={{ "--zt-chooser-anchor": anchorName, ...style } as CSSProperties}
    />
  );
}

export interface ChooserInputProps {
  placeholder: string;
  clearLabel: string;
}

/**
 * The search field. The query lives in the root's state; this part reads it
 * and writes it back, and every row list below filters by that same query.
 *
 * It is also where DOM focus stays while the highlight moves, so it is the
 * element that names the highlighted row as its active descendant: a screen
 * reader follows the active descendant of whatever holds focus.
 */
function Input({ placeholder, clearLabel }: ChooserInputProps) {
  const { query, setQuery, open, listId, activeOptionId } = useChooser();
  return (
    <SearchInput
      autoFocus
      role="combobox"
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={activeOptionId ?? undefined}
      className="zt:mb-1 zt:shrink-0"
      value={query}
      onChange={setQuery}
      placeholder={placeholder}
      clearLabel={clearLabel}
    />
  );
}

export interface ChooserListProps<Row extends ChooserRow> extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  /** Every row the caller offers, in the order it wants them read. */
  items: readonly Row[];
  /**
   * Shown in place of the rows when the query matches none of them.
   *
   * Spec aidenlx/zotlit#1190 names this a `Chooser.Empty` part. It stays a
   * prop: the query filter runs here, so only this part knows the rows came
   * out empty, and a sibling part would mean hoisting the row list into the
   * root and making the root generic over the row type.
   */
  emptyLabel: string;
  children: (row: Row) => ReactNode;
}

function List<Row extends ChooserRow>({
  items,
  emptyLabel,
  children,
  className,
  ...rest
}: ChooserListProps<Row>) {
  const { query, listId, listRef, highlight, optionId, publishRows } =
    useChooser();
  const rows = useMemo(
    () => visibleRows(items, query ? prepareFuzzySearch(query) : null),
    [items, query],
  );

  // The keys are registered on the root, so the rows they move over have to
  // reach it. The list is where the query filter runs, so it is the only part
  // that knows them.
  useLayoutEffect(() => publishRows(rows), [rows, publishRows]);

  const active = clampedHighlight(highlight, rows.length);
  const list = useMemo<ChooserListState>(
    () => ({
      indexOf: new Map(rows.map((row, index) => [row.value, index])),
      rows,
      active,
      optionId,
    }),
    [rows, active, optionId],
  );

  return (
    <div
      ref={listRef}
      id={listId}
      role="listbox"
      aria-multiselectable
      aria-activedescendant={active < 0 ? undefined : optionId(active)}
      {...rest}
      className={cn("zt:min-h-0 zt:flex-1 zt:overflow-y-auto", className)}
    >
      {rows.length === 0 ? (
        <div className="zt:px-2 zt:py-1 zt:text-xs zt:text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <ChooserListContext value={list}>
          {rows.map(children)}
        </ChooserListContext>
      )}
    </div>
  );
}

export interface ChooserItemProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
  disabled?: boolean;
}

/**
 * A tickable row. Ticking hands the whole next selection to the caller and
 * leaves the popup standing, so several rows can be ticked in one visit.
 *
 * The row carries no tab stop. The Chooser has exactly one — the search field —
 * and the highlight below is row state plus a scroll-into-view that the list
 * names as its active descendant, so a user narrows, moves and ticks without
 * the caret ever leaving what they are typing into.
 *
 * The tick is a styled indicator rather than a checkbox, because a list box
 * option may hold no focusable control; `aria-selected` is what reports it.
 */
function Item({
  value,
  disabled,
  className,
  children,
  ...rest
}: ChooserItemProps) {
  const { selected, onValueChange } = useChooser();
  const { indexOf, rows, active, optionId } = useChooserList();
  const ref = useRef<HTMLDivElement>(null);

  const index = indexOf.get(value) ?? -1;
  const highlighted = index >= 0 && index === active;
  const ticked = selected.includes(value);
  const off = disabled ?? rows[index]?.disabled ?? false;

  useLayoutEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  return (
    <div
      ref={ref}
      id={index < 0 ? undefined : optionId(index)}
      role="option"
      aria-selected={ticked}
      aria-disabled={off || undefined}
      data-highlighted={highlighted ? "" : undefined}
      onClick={(event) => {
        event.stopPropagation();
        if (off) return;
        onValueChange(toggledValues(selected, value));
      }}
      {...rest}
      className={cn(
        "zt:flex zt:cursor-clickable zt:items-center zt:gap-1.5 zt:rounded-sm zt:px-2 zt:py-1 zt:text-sm",
        off ? "zt:text-muted-foreground" : "zt:hover:bg-muted",
        "zt:data-highlighted:bg-muted",
        className,
      )}
    >
      <Icon
        name="check"
        size={14}
        className={cn("zt:shrink-0", !ticked && "zt:invisible")}
      />
      <span className="zt:truncate">{children}</span>
    </div>
  );
}

Chooser.Trigger = Trigger;
Chooser.Popup = Popup;
Chooser.Input = Input;
Chooser.List = List;
Chooser.Item = Item;
