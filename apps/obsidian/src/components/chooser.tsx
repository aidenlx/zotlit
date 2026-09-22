// The Chooser: an anchored popover holding a search field and tickable rows.
//
// The popup is a native popover in the browser's top layer, so the platform
// owns showing it, the outside click and Escape; CSS anchor positioning places
// it and flips it, so nothing here measures or moves it. It wears no Obsidian
// menu class and takes menu chrome as CSS variables instead.
//
// @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md

import { prepareFuzzySearch } from "obsidian";
import { createContext, useContext, useMemo, useState } from "react";
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
  Ref,
} from "react";

import { Icon } from "@/components/obsidian/icon";
import { SearchInput } from "@/components/obsidian/search-input";
import { themeHook } from "@/lib/theme-hooks";
import { activatable, cn } from "@/lib/utils";

import { toggledValues, visibleRows } from "./chooser-logic";
import type { ChooserRow } from "./chooser-logic";
import "./chooser.css";

// The decision logic is a sibling file; this module is the entry, so its
// surface is reachable from here too.
export { toggledValues, visibleRows };
export type { ChooserMatcher, ChooserRow } from "./chooser-logic";

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
}

const ChooserContext = createContext<ChooserState | null>(null);

function useChooser(): ChooserState {
  const state = useContext(ChooserContext);
  if (!state) throw new Error("Chooser part rendered outside a Chooser");
  return state;
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
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [popupId] = useState(() => `zt-chooser-${(chooserSequence += 1)}`);

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
    }),
    [value, onValueChange, query, open, popupId],
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
 */
function Input({ placeholder, clearLabel }: ChooserInputProps) {
  const { query, setQuery } = useChooser();
  return (
    <SearchInput
      autoFocus
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
  const { query } = useChooser();
  const rows = useMemo(
    () => visibleRows(items, query ? prepareFuzzySearch(query) : null),
    [items, query],
  );

  return (
    <div
      role="listbox"
      aria-multiselectable
      {...rest}
      className={cn("zt:min-h-0 zt:flex-1 zt:overflow-y-auto", className)}
    >
      {rows.length === 0 ? (
        <div className="zt:px-2 zt:py-1 zt:text-xs zt:text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        rows.map(children)
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
 * `activatable` gives each row its own tab stop. That is a bridge: it keeps
 * the tag filter reachable by keyboard until aidenlx/zotlit#1192 moves the
 * Chooser to a single tab stop in the search field with `aria-activedescendant`.
 */
function Item({
  value,
  disabled,
  className,
  children,
  ...rest
}: ChooserItemProps) {
  const { selected, onValueChange } = useChooser();
  const ticked = selected.includes(value);
  return (
    <div
      {...activatable(() => onValueChange(toggledValues(selected, value)), {
        disabled,
      })}
      role="option"
      aria-selected={ticked}
      aria-disabled={disabled || undefined}
      {...rest}
      className={cn(
        "zt:flex zt:cursor-clickable zt:items-center zt:gap-1.5 zt:rounded-sm zt:px-2 zt:py-1 zt:text-sm",
        disabled ? "zt:text-muted-foreground" : "zt:hover:bg-muted",
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
