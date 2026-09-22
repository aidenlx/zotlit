// The Chooser: an anchored popover holding a search field, tickable rows in
// optional groups, and action rows that run something instead of ticking.
//
// An action row is an option in the same list as the entries and scrolls with
// them, so one highlight and one Enter reach both. A group heading is no
// option, and the highlight never lands on one.
//
// The popup is a native popover in the browser's top layer, so the platform
// owns showing it, the outside click and Escape; CSS anchor positioning places
// it and flips it, so nothing here measures or moves it. It wears no Obsidian
// menu class and takes menu chrome as CSS variables instead.
//
// The keyboard is Obsidian's: one Scope per mounted Chooser, parented to the
// app scope and pushed while the popup stands, so a key it never registered
// reaches Obsidian's own hotkeys, while every key it did register stops here.
// The highlight is row state, a scroll-into-view and an active descendant,
// never real focus — but something inside the popup has to hold DOM focus and
// name it, or a screen reader is told nothing. The search field holds it
// throughout when the caller rendered one, and the list box holds it when the
// caller left the search out.
//
// @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md

import { Scope, prepareFuzzySearch } from "obsidian";
import type { IconName } from "obsidian";
import {
  Fragment,
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
  activatedRow,
  chooserLayout,
  clampedHighlight,
  movedHighlight,
  rehomedHighlight,
} from "./chooser-logic";
import type {
  ChooserActivation,
  ChooserGroup,
  ChooserMove,
  ChooserRow,
} from "./chooser-logic";
import "./chooser.css";

// `chooser-logic.ts` is a module of its own rather than an implementation
// detail behind this one, and it is the single entry to what a Chooser
// decides: every consumer takes its rows, its groups and its toggle rule from
// there — this component, the callers that write rows, and the Annotation
// View's store, which toggles a tag from outside React and would otherwise
// pull the whole component graph in behind a re-export. Nothing here
// re-exports any part of it, so its surface has one door.

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
  /** The popup element, held so an action can shut the popup it ran from. */
  popupRef: RefObject<HTMLDivElement | null>;
  /** Shuts the popup. Only an action ever calls it; a tick never does. */
  close: () => void;
  listId: string;
  /** The row box, which a page step measures itself against. */
  listRef: RefObject<HTMLDivElement | null>;
  publishRows: (rows: readonly ChooserRow[]) => void;
  /** Puts the highlight on a row, as a click on it asks. */
  highlightRow: (index: number) => void;
  /** The `id` of the row at an index, for `aria-activedescendant`. */
  optionId: (index: number) => string;
  /**
   * The highlighted row's index, clamped to the rows the list last published,
   * or `-1` while it points at no row.
   *
   * The root is the one place the highlight is resolved against a row set. The
   * list derived it a second time from its own freshly filtered copy, and for
   * the one render between a keystroke and the publish that follows it the two
   * copies disagreed — so the search field and the list box named different
   * rows as the active descendant.
   */
  active: number;
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
 * Carrying out what {@link activatedRow} decided. Enter on the highlight and a
 * click on a row both come through here, so a row carrying an action runs on
 * both and a row carrying none ticks on both — one model rather than two.
 */
function runActivation(
  activation: ChooserActivation,
  close: () => void,
  emit: (next: string[]) => void,
): void {
  if (activation.kind === "action") activation.run(close);
  else if (activation.kind === "select") emit(activation.values);
}

/**
 * How many rows a Page Up or Page Down step covers: as many whole rows as the
 * scroll box shows. Read off the DOM at the moment the key fires, because a
 * themed row height and a flipped popup both change it.
 *
 * A list with no row to measure answers zero, and so does a box too short to
 * hold one whole row. Neither is special-cased here: {@link movedHighlight}
 * already takes a page of at least one row, and a list with no measurable row
 * has no row for a page step to move over either.
 */
function pageSizeOf(list: HTMLElement | null): number {
  const row = list?.querySelector<HTMLElement>('[role="option"]');
  if (!list || !row || row.offsetHeight === 0) return 0;
  return Math.floor(list.clientHeight / row.offsetHeight);
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
  const [query, setQueryState] = useState("");
  const [open, setOpen] = useState(false);
  const [popupId] = useState(() => `zt-chooser-${(chooserSequence += 1)}`);
  const [rows, setRows] = useState<readonly ChooserRow[]>([]);
  // No row is highlighted until a key names one or a row is clicked: a popup
  // that opened with its first row darkened told a pointer user it was chosen.
  const [highlight, setHighlight] = useState(-1);

  /**
   * A query hands the highlight to the first match, so Enter takes what the
   * user typed toward, and an emptied query takes the highlight away again.
   * The rows that publish after this re-home it from there.
   */
  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setHighlight(next.length > 0 ? 0 : -1);
  }, []);
  const listRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => popupRef.current?.hidePopover(), []);

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
    // Every handler below answers `false` once it has decided the key is its
    // own, composition aside. A key the Chooser registered is a key it
    // consumed: letting one fall through because the list happened to be empty
    // or the row happened to refuse a tick would hand Obsidian a hotkey the
    // user aimed at the popup standing in front of it. Falling through is for
    // keys this scope never registered, which reach the app scope it is
    // parented to.
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
    // Enter reaches an action row exactly as it reaches an entry: one key, one
    // highlight, and the row itself deciding whether it ticks or runs.
    const activate = (event: KeyboardEvent) => {
      if (composing(event)) return;
      const {
        rows: shown,
        highlight: at,
        selected,
        onValueChange: emit,
      } = latest.current;
      const row = shown[clampedHighlight(at, shown.length)];
      runActivation(activatedRow(row, selected), close, emit);
      return false;
    };
    // Escape is absent on purpose: the popover's own light dismiss closes it,
    // and a handler here returning `false` would preventDefault and suppress
    // that. Ctrl-P and Ctrl-N repeat the arrows, the way every Obsidian list
    // does.
    const stack = new DisposableStack();
    stack.use(registerKeymap(scope, [], "ArrowUp", move("previous")));
    stack.use(registerKeymap(scope, [], "ArrowDown", move("next")));
    stack.use(registerKeymap(scope, [], "PageUp", move("page-up")));
    stack.use(registerKeymap(scope, [], "PageDown", move("page-down")));
    stack.use(registerKeymap(scope, [], "Home", move("first")));
    stack.use(registerKeymap(scope, [], "End", move("last")));
    stack.use(registerKeymap(scope, ["Ctrl"], "p", move("previous")));
    stack.use(registerKeymap(scope, ["Ctrl"], "n", move("next")));
    stack.use(registerKeymap(scope, [], "Enter", activate));
    return () => stack.dispose();
  }, [scope, close]);

  /**
   * Pushed and popped on the popup's own toggle event, so the Chooser holds
   * the keyboard exactly while it is on screen and a closed one is inert.
   *
   * DOM focus moves into the popup at the same moment, because the highlight
   * is named by whatever element holds focus: a screen reader follows the
   * active descendant of the focused element, and Enter on a trigger that kept
   * focus is the invoker press that shuts the popup again. The search field
   * takes focus when the caller rendered one; the list box takes it otherwise,
   * which is why the list carries a programmatic tab index. The search part is
   * optional, so the highlight cannot depend on it to have an owner.
   */
  useLayoutEffect(() => {
    if (!open) return;
    setHighlight(-1);
    const field = popupRef.current?.querySelector<HTMLElement>("input");
    (field ?? listRef.current)?.focus();
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
      popupRef,
      close,
      listId: `${popupId}-list`,
      listRef,
      publishRows,
      highlightRow: setHighlight,
      optionId,
      active,
      activeOptionId: active < 0 ? null : optionId(active),
    }),
    [
      value,
      onValueChange,
      query,
      setQuery,
      open,
      popupId,
      close,
      publishRows,
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
 *
 * Spec aidenlx/zotlit#1190 names a `Chooser.Value` part inside it. There is
 * none: a part that renders the selection has to decide what a selection
 * reads as, and the two callers disagree — the colour filter draws its
 * selection as swatches and the tag filter as a count beside a glyph. The
 * trigger takes children instead, so each caller writes its own.
 *
 * The element stays bare rather than wearing the `Button` wrapper from
 * `src/components/obsidian/`, which the decision tree asks for wherever a
 * native component exists. What that wrapper supplies — Obsidian's button box
 * and its `mod-*` variants — is what this control must not wear: the trigger
 * stands as a chip, and the data chips it stands beside are `<span>`s — the
 * tag filter's `TagPill` among them — so a trigger is the only chip that ever
 * wears Obsidian's button box. `chooser.css` rolls that box back, so the
 * caller's utilities draw it. The wrapper would add `variant`, `loading` and
 * `icon` with no caller to take them, and save no rule: both routes render a
 * `<button>` inside `.zt-root`, so Obsidian's unlayered `button` rules reach
 * it either way. The attribute is not the difference — `Button` spreads
 * `popovertarget` through to its own element as this one does.
 *
 * @see ./chooser.css
 * @see .agents/skills/obsidian-css/SKILL.md
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
        themeHook.chooserTrigger,
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
 * Its height is the smaller of a comfortable list and the room the trigger
 * leaves: `position-area` makes the space on the chosen side the popup's
 * containing block, so a percentage height resolves against that space and
 * against the space on the other side once `flip-block` has flipped it. The
 * cap keeps a long vocabulary from filling a tall pane; the percentage keeps
 * a popup near an edge inside the viewport, scrolling its rows instead of
 * running off it.
 *
 * The display utility is gated on `:popover-open`. A closed popover is hidden
 * by the user-agent rule `[popover]:not(:popover-open) { display: none }`, and
 * an unconditional author-origin `display` outranks it — the popup then keeps
 * painting after it closes, dropping out of the top layer so the view behind
 * draws over it. It reads as a popup that will not close and has lost its
 * background.
 */
function Popup({ className, style, ref, ...rest }: ChooserPopupProps) {
  const { anchorName, popupId, popupRef, setOpen } = useChooser();
  /**
   * The root holds the popup element too, beside whatever ref the caller
   * passed. Two things reach for it: opening moves DOM focus to the search
   * field inside it, and an action row closes the popup it ran from by hiding
   * this element — the capability #1193 asks for when it says running an
   * action leaves the popup standing unless the action chooses otherwise. In a
   * popout window this element is also the only handle on the right document's
   * popup.
   *
   * Memoised because a fresh callback ref is detached and reattached on every
   * render, which would null `popupRef` and the caller's ref mid-flight.
   */
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      popupRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [popupRef, ref],
  );
  return (
    <div
      ref={attach}
      id={popupId}
      popover="auto"
      onToggle={(event) => setOpen(event.newState === "open")}
      {...rest}
      className={cn(
        themeHook.chooser,
        "zt:inset-auto zt:my-1 zt:[max-height:min(--spacing(75),calc(100%_-_--spacing(2)))] zt:max-w-80 zt:min-w-50 zt:flex-col zt:[&:popover-open]:flex",
        // No padding of its own: the search field runs edge to edge over its
        // rule, and the list carries the inset, as Obsidian's Bases toolbar
        // menus are built.
        "zt:border-(length:--menu-border-width) zt:border-(--menu-border-color) zt:bg-(--menu-background) zt:text-foreground zt:shadow-(--menu-shadow)",
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
 *
 * The combobox role and the two attributes beside it are what make that
 * announcement work, and are kept for that: a search box naming an active
 * descendant says nothing about the list the row lives in, while a combobox
 * that controls the list box and reports itself expanded is the pattern a
 * screen reader reads the pair as. The root moves focus here on open rather
 * than this part claiming it, because a Chooser without a search field has to
 * hand the highlight another owner.
 *
 * It is a text field rather than a search field so that Escape stays the
 * platform's: a search field answers Escape itself by clearing its query, and
 * the popup's light dismiss then never sees the key while a query stands.
 */
function Input({ placeholder, clearLabel }: ChooserInputProps) {
  const { query, setQuery, open, listId, activeOptionId } = useChooser();
  return (
    <SearchInput
      type="text"
      role="combobox"
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={activeOptionId ?? undefined}
      // The flat field a Bases toolbar menu opens with, drawn in `chooser.css`:
      // Obsidian rounds the container and boxes the input unlayered, where no
      // utility reaches either.
      className="zt:shrink-0"
      value={query}
      onChange={setQuery}
      placeholder={placeholder}
      clearLabel={clearLabel}
    />
  );
}

export interface ChooserListProps<Row extends ChooserRow> extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "aria-label"
> {
  /**
   * What the list box is called. Required rather than optional: a list box
   * carries no name of its own, and an unnamed one is announced as a bare
   * "list box" — the caller is the only one that knows whether its rows are
   * tags or colours.
   */
  "aria-label": string;
  /**
   * Every row the caller offers, in the order it wants them read, split into
   * the groups it wants them drawn in. A group is a heading and a separator,
   * never a second highlight: the rows below run on as one sequence.
   *
   * Spec aidenlx/zotlit#1190 names `Chooser.Group`, `Chooser.GroupLabel` and
   * `Chooser.Separator` as parts. They stay data on this prop, as the sibling
   * `Chooser.Empty` deviation does and for the same reason: the query filter
   * runs here, so this part is the only one that knows which groups a query
   * left standing. Parts would have each group filter itself, and neither a
   * heading nor a rule could then be dropped with the rows it belongs to —
   * the group would have to report emptiness back up to a parent that had
   * already drawn its separator.
   */
  groups: readonly ChooserGroup<Row>[];
  /**
   * Shown beside the rows when the query matches none of them.
   *
   * Spec aidenlx/zotlit#1190 names this a `Chooser.Empty` part. It stays a
   * prop: the query filter runs here, so only this part knows the rows came
   * out empty, and a sibling part would mean hoisting the row list into the
   * root and making the root generic over the row type.
   *
   * Optional, because a Chooser the caller gave no search field cannot come
   * out empty: nothing narrows its rows, so the message would be copy for a
   * state that never happens. Leaving it out draws no message and no live
   * region.
   */
  emptyLabel?: string;
  children: (row: Row) => ReactNode;
}

function List<Row extends ChooserRow>({
  groups,
  emptyLabel,
  children,
  className,
  ...rest
}: ChooserListProps<Row>) {
  const {
    query,
    listId,
    listRef,
    active,
    activeOptionId,
    optionId,
    publishRows,
  } = useChooser();
  const { sections, rows, empty } = useMemo(
    () => chooserLayout(groups, query ? prepareFuzzySearch(query) : null),
    [groups, query],
  );

  // The keys are registered on the root, so the rows they move over have to
  // reach it. The list is where the query filter runs, so it is the only part
  // that knows them; where the highlight then lands is the root's to say.
  useLayoutEffect(() => publishRows(rows), [rows, publishRows]);

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
    <>
      {/* The empty message stands beside the rows rather than in their place:
          action rows are exempt from the query, so a query that matches no
          entry can still leave one standing, and "nothing matched" and "here
          is what you can still do" are both true at once.

          It sits outside the list box and carries a live region, because a
          list box owns options: a bare `div` among them is dropped by
          assistive technology, and the one moment the message matters is the
          keystroke that empties the list — which is a live region's job to
          announce. The region is mounted for as long as the caller offers a
          message, and only its text comes and goes; a region that appears
          with its text is announced by no screen reader reliably. With no
          text it draws no box, so it costs the rows no room. */}
      {emptyLabel !== undefined && (
        <div
          role="status"
          className={cn(
            "zt:shrink-0 zt:px-2 zt:text-xs zt:text-muted-foreground",
            empty && "zt:py-1",
          )}
        >
          {empty ? emptyLabel : ""}
        </div>
      )}
      {/* The tab index is programmatic: the root focuses this element when the
          caller rendered no search field, and a Chooser still holds exactly
          one tab stop either way. */}
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        tabIndex={-1}
        aria-multiselectable
        aria-activedescendant={activeOptionId ?? undefined}
        {...rest}
        className={cn(
          "zt:min-h-0 zt:flex-1 zt:overflow-y-auto zt:p-1.5",
          className,
        )}
      >
        <ChooserListContext value={list}>
          {sections.map((section, index) => (
            <Fragment key={section.groupIndex}>
              {(index > 0 || empty) && <Separator />}
              {section.label === undefined ? (
                section.rows.map(children)
              ) : (
                // A labelled run is a list-box group, so a screen reader reads
                // the heading with the rows under it. The heading itself is no
                // option and carries no id the highlight can point at.
                <div
                  role="group"
                  aria-labelledby={`${listId}-group-${section.groupIndex}`}
                >
                  <div
                    id={`${listId}-group-${section.groupIndex}`}
                    className="zt:ps-1.5 zt:pt-1 zt:pb-0.5 zt:text-xs zt:text-muted-foreground"
                  >
                    {section.label}
                  </div>
                  {section.rows.map(children)}
                </div>
              )}
            </Fragment>
          ))}
        </ChooserListContext>
      </div>
    </>
  );
}

/**
 * The rule between two groups. `--menu-divider-*` are declared only in
 * Obsidian's mobile blocks and resolve to nothing on the desktop this plugin
 * ships for, so each one carries the fallback that keeps the rule visible —
 * the theme's own border colour, which is what Obsidian's own menus draw.
 */
function Separator() {
  return (
    <div
      role="presentation"
      aria-hidden
      className="zt:my-1 zt:h-[var(--menu-divider-width,1px)] zt:bg-[var(--menu-divider-color,var(--background-modifier-border))]"
    />
  );
}

/**
 * What {@link RowShell} needs of a row: where it sits in the list, whether the
 * highlight is on it, whether it is disabled, the scroll-into-view that keeps
 * the highlight in sight, and what activating it comes to. An entry and an
 * action ask the same question, so one keyboard model reaches both.
 *
 * Whether a row is disabled is read off the published row alone, never off a
 * prop beside it: the key handler reads the same flag, so a row the pointer
 * refuses and a row Enter refuses are the same row.
 */
function useRowSlot(value: string) {
  const { selected, onValueChange, close, highlightRow } = useChooser();
  const { indexOf, rows, active, optionId } = useChooserList();
  const ref = useRef<HTMLDivElement>(null);

  const index = indexOf.get(value) ?? -1;
  const row = rows[index];
  const highlighted = index >= 0 && index === active;

  useLayoutEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  return {
    ref,
    id: index < 0 ? undefined : optionId(index),
    highlighted,
    disabled: row?.disabled ?? false,
    /**
     * A click on the row, decided exactly as Enter on the highlight is. It
     * moves the highlight onto the row first, as a click in Obsidian's own
     * Bases toolbar menu does, so the arrow keys carry on from the row that
     * was just ticked. The pointer merely passing over a row moves nothing:
     * the highlight is the keyboard's mark and stays where a key or a click
     * put it while the pointer wanders in and out of the popup, and what the
     * pointer rests on is drawn by the row's own hover tint.
     */
    activate: () => {
      if (index >= 0) highlightRow(index);
      runActivation(activatedRow(row, selected), close, onValueChange);
    },
  };
}

/** The box an entry and an action are both drawn in. */
const rowBox = (disabled: boolean, className?: string) =>
  cn(
    // The row a Bases toolbar menu draws: 4px of padding, 6px before the
    // mark, an 8px gap between the mark and the name.
    "zt:flex zt:cursor-clickable zt:items-center zt:gap-2 zt:rounded-sm zt:py-1 zt:ps-1.5 zt:pe-1 zt:text-sm",
    // Two tints on one row box: the pointer's, which is the platform's hover
    // state and leaves with the pointer, and the highlight's, which is row
    // state and stays put until a key or a click moves it.
    disabled ? "zt:text-muted-foreground" : "zt:hover:bg-muted",
    "zt:data-highlighted:bg-muted",
    className,
  );

interface RowShellProps extends HTMLAttributes<HTMLDivElement> {
  /** Which published row this draws. */
  value: string;
  /** What the row reports as its selected state; an action row holds none. */
  selected: boolean;
  /**
   * The glyph in the row's leading column. Leaving it out keeps the column and
   * draws nothing in it, so every label in the list lines up either way.
   */
  icon?: IconName;
}

/**
 * The option every row is drawn as: its place in the list, its highlight, its
 * disabled state, what a click on it comes to, and the box holding a leading
 * glyph and one line of label. {@link Item} and {@link Action} differ in what
 * they put in those two slots and in nothing else, so the element itself is
 * written once and one keyboard model reaches both.
 */
function RowShell({
  value,
  selected,
  icon,
  className,
  children,
  ...rest
}: RowShellProps) {
  const { ref, id, highlighted, disabled, activate } = useRowSlot(value);

  return (
    <div
      ref={ref}
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      data-highlighted={highlighted ? "" : undefined}
      onClick={activate}
      {...rest}
      className={rowBox(disabled, className)}
    >
      <Icon
        name={icon ?? "check"}
        size={14}
        className={cn("zt:shrink-0", !icon && "zt:invisible")}
      />
      <span className="zt:truncate">{children}</span>
    </div>
  );
}

export interface ChooserItemProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Which published row this draws. Everything else about the row — whether it
   * is disabled, and whether it ticks or runs — travels with the row itself,
   * so the pointer and the keyboard read one flag rather than two.
   */
  value: string;
}

/**
 * A tickable row. Ticking hands the whole next selection to the caller and
 * leaves the popup standing, so several rows can be ticked in one visit.
 *
 * The row carries no tab stop. The Chooser has exactly one — the search field,
 * or the list box itself when the caller rendered no search field — and the
 * highlight below is row state plus a scroll-into-view that the tab stop names
 * as its active descendant, so a user narrows, moves and ticks without the
 * caret ever leaving what they are typing into.
 *
 * The tick is a styled indicator rather than a checkbox, because a list box
 * option may hold no focusable control; `aria-selected` is what reports it.
 *
 * Spec aidenlx/zotlit#1190 names `Chooser.ItemText` and `Chooser.ItemIndicator`
 * as parts inside it. There are none: a row is a tick and one line of label in
 * that order, always, and the two parts exist to let a caller reorder or
 * restyle a pair this one draws itself. The caller's children are the label,
 * and the indicator is the row's own.
 *
 * It stays a separate part from {@link Action} rather than one row component
 * with a flag: the two say different things — one ticks and reports
 * `aria-selected`, the other runs and reports none. What they draw the same is
 * drawn once, in {@link RowShell}.
 */
function Item({ value, ...rest }: ChooserItemProps) {
  const { selected } = useChooser();
  const ticked = selected.includes(value);

  return (
    <RowShell
      value={value}
      selected={ticked}
      icon={ticked ? "check" : undefined}
      {...rest}
    />
  );
}

export interface ChooserActionProps extends HTMLAttributes<HTMLDivElement> {
  /** Which published row this draws; what it runs travels with that row. */
  value: string;
  /**
   * The glyph in the tick's place. Without one the row keeps the tick's width
   * anyway, so its label lines up with the entries above it.
   *
   * It goes beyond what #1193 asked for and is kept because the gap it fills
   * misreads: an action row standing among entries with an empty tick column
   * reads as an entry nobody has ticked yet. A glyph is what says the row does
   * something instead.
   */
  icon?: IconName;
}

/**
 * A row that runs something instead of ticking. What it runs travels with the
 * row the caller handed the list, so Enter on the highlight and a click on the
 * row reach the same callback.
 *
 * It is an option in the same list as the entries, not a pinned footer: it
 * scrolls with them, the arrow keys walk onto it, and it reports its selected
 * state as false because it holds none. Running it leaves the popup standing
 * unless the action calls the `close` it is handed.
 */
function Action({ value, icon, ...rest }: ChooserActionProps) {
  return <RowShell value={value} selected={false} icon={icon} {...rest} />;
}

Chooser.Trigger = Trigger;
Chooser.Popup = Popup;
Chooser.Input = Input;
Chooser.List = List;
Chooser.Item = Item;
Chooser.Action = Action;
