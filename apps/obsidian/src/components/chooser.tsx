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
// The keyboard is Obsidian's: one Scope per open of the popup, parented to the
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
  useEffect,
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

import { useUniqueId } from "@zotlit/ui";

import { Icon } from "@/components/obsidian/icon";
import { SearchInput } from "@/components/obsidian/search-input";
import { useObsidianApp } from "@/lib/app-context";
import { registerKeymap } from "@/lib/disposables";
import { composing } from "@/lib/ime";
import { themeHook } from "@/lib/theme-hooks";
import { cn, tooltipAttrs } from "@/lib/utils";

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
import { tooltipHostRoot } from "./popover-surface";
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
  /** What the browser last reported through the popup's beforetoggle event. */
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
  /** The page an open from outside the popup starts on, read once by the session. */
  firstPage: RefObject<string | null>;
  /** The search an open from outside the popup starts with, read once by the session. */
  firstQuery: RefObject<string>;
  /** The open session's `openPage`, while a session stands. */
  sessionPage: RefObject<((page: string) => void) | null>;
}

const ChooserContext = createContext<ChooserState | null>(null);

function useChooser(): ChooserState {
  const state = useContext(ChooserContext);
  if (!state) throw new Error("Chooser part rendered outside a Chooser");
  return state;
}

/**
 * What one open of the popup holds: the search, the rows it leaves, the
 * highlight and the keyboard. It mounts with the open popup and unmounts when
 * the popup closes, so each open starts from a fresh session.
 */
interface ChooserSessionState {
  query: string;
  setQuery: (next: string) => void;
  publishRows: (rows: readonly ChooserRow[]) => void;
  /** Puts the highlight on a row, as a click on it asks. */
  highlightRow: (index: number) => void;
  /** The `id` of the row at an index, for `aria-activedescendant`. */
  optionId: (index: number) => string;
  /**
   * The highlighted row's index, clamped to the rows the list last published,
   * or `-1` while it points at no row.
   *
   * The session is the one place the highlight is resolved against a row set. The
   * list derived it a second time from its own freshly filtered copy, and for
   * the one render between a keystroke and the publish that follows it the two
   * copies disagreed — so the search field and the list box named different
   * rows as the active descendant.
   */
  active: number;
  /** The `id` the highlight points at, or `null` while it points at no row. */
  activeOptionId: string | null;
  /** The Scope the Chooser holds the keyboard with while the popup stands. */
  scope: Scope;
  /** The highlighted row's value at the moment a key fires, else `null`. */
  activeValue: () => string | null;
  /** The page on screen in place of the rows, or `null` on the rows. */
  page: string | null;
  /** Opens a page over the one on screen. */
  openPage: (page: string) => void;
  /** Steps back to the page under this one, or to the rows. */
  back: () => void;
  /** Puts another page in the place of the one on screen. */
  replacePage: (page: string) => void;
}

const ChooserSessionContext = createContext<ChooserSessionState | null>(null);

function useChooserSession(): ChooserSessionState {
  const state = useContext(ChooserSessionContext);
  if (!state) throw new Error("Chooser part rendered outside a Chooser.Popup");
  return state;
}

/**
 * The search term in the Chooser's search field, for a caller whose rows
 * depend on it, such as an action that creates what the user typed.
 */
export function useChooserQuery(): string {
  return useChooserSession().query;
}

/**
 * The Chooser's Scope and its highlighted row, for a caller that adds keys of
 * its own, such as a key that moves the highlighted row. A key registered on
 * the scope reaches the caller only while the popup stands.
 */
export function useChooserScope(): Pick<
  ChooserSessionState,
  "scope" | "activeValue"
> {
  const { scope, activeValue } = useChooserSession();
  return { scope, activeValue };
}

/**
 * The page stack of an open popup, as a Bases toolbar menu steps from its
 * rows to a row's page and back. A page is named by a string the caller
 * reads back in {@link Page}.
 */
export function useChooserPage(): Pick<
  ChooserSessionState,
  "page" | "openPage" | "back" | "replacePage"
> {
  const { page, openPage, back, replacePage } = useChooserSession();
  return { page, openPage, back, replacePage };
}

/**
 * Opens the popup on a page, from outside it, such as a right-click on the
 * trigger. A popup that stands already opens the page over the one on screen.
 */
export function useChooserOpenPage(): (page: string) => void {
  const { popupRef, firstPage, sessionPage } = useChooser();
  return useCallback(
    (page: string) => {
      const open = sessionPage.current;
      if (open) return open(page);
      firstPage.current = page;
      popupRef.current?.showPopover();
    },
    [popupRef, firstPage, sessionPage],
  );
}

/**
 * Opens the popup with `query` already in its search field, as a key typed on
 * the trigger opens a Bases combobox searching for that key. A popup that
 * stands already keeps its search.
 */
export function useChooserOpenSearch(): (query: string) => void {
  const { popupRef, firstQuery, open } = useChooser();
  return useCallback(
    (query: string) => {
      if (open) return;
      firstQuery.current = query;
      popupRef.current?.showPopover();
    },
    [popupRef, firstQuery, open],
  );
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
  // A list with a pinned group scrolls a box inside it.
  const box = list?.querySelector<HTMLElement>("[data-chooser-scroll]") ?? list;
  const row = box?.querySelector<HTMLElement>('[role="option"]');
  if (!box || !row || row.offsetHeight === 0) return 0;
  return Math.floor(box.clientHeight / row.offsetHeight);
}

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
  const [open, setOpen] = useState(false);
  // An anchor name is a global identifier, so each mounted Chooser takes one
  // of its own rather than accepting one from its caller.
  const popupId = useUniqueId();
  const listRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => popupRef.current?.hidePopover(), []);
  const firstPage = useRef<string | null>(null);
  const firstQuery = useRef("");
  const sessionPage = useRef<((page: string) => void) | null>(null);

  const state = useMemo<ChooserState>(
    () => ({
      selected: value,
      onValueChange,
      open,
      setOpen,
      anchorName: `--${popupId}`,
      popupId,
      popupRef,
      close,
      listId: `${popupId}-list`,
      listRef,
      firstPage,
      firstQuery,
      sessionPage,
    }),
    [value, onValueChange, open, popupId, close],
  );

  return <ChooserContext value={state}>{children}</ChooserContext>;
}

/**
 * One open of the popup: the search, the rows, the highlight and the
 * keyboard. {@link Popup} mounts it when the popup opens and unmounts it when
 * the popup closes, so each open starts with an empty search and no
 * highlight, and the first frame the popup paints already shows them.
 */
function ChooserSession({ children }: { children: ReactNode }) {
  const app = useObsidianApp();
  const {
    selected,
    onValueChange,
    popupId,
    popupRef,
    close,
    listRef,
    firstPage,
    firstQuery,
    sessionPage,
  } = useChooser();
  const [query, setQueryState] = useState(() => {
    const first = firstQuery.current;
    firstQuery.current = "";
    return first;
  });
  // The pages opened over the rows, the one on screen last. An open from
  // outside the popup can start on a page.
  const [pages, setPages] = useState<readonly string[]>(() => {
    const first = firstPage.current;
    firstPage.current = null;
    return first === null ? [] : [first];
  });
  const page = pages.at(-1) ?? null;

  // A page leaves the DOM with no blur event, so a field that saves on blur
  // saves again as its page unmounts.
  // A page already on screen stays one step deep, as a second right-click
  // on the trigger asks for the page that stands.
  const openPage = useCallback(
    (page: string) =>
      setPages((now) => (now.at(-1) === page ? now : [...now, page])),
    [],
  );
  const back = useCallback(() => setPages((now) => now.slice(0, -1)), []);
  const replacePage = useCallback(
    (page: string) => setPages((now) => [...now.slice(0, -1), page]),
    [],
  );

  const [rows, setRows] = useState<readonly ChooserRow[]>([]);
  // No row is highlighted until a key names one or a row is clicked: a popup
  // that opened with its first row darkened told a pointer user it was chosen.
  // A search the popup opened with highlights its first match, as typing one does.
  const [highlight, setHighlight] = useState(query.length > 0 ? 0 : -1);

  /**
   * A query hands the highlight to the first match, so Enter takes what the
   * user typed toward, and an emptied query takes the highlight away again.
   * The rows that publish after this re-home it from there.
   */
  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setHighlight(next.length > 0 ? 0 : -1);
  }, []);

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
  const latest = useRef({ rows, highlight, selected, onValueChange, page });
  latest.current = { rows, highlight, selected, onValueChange, page };

  /**
   * A rebuilt row set re-homes the highlight rather than keeping its index: a
   * tick rebuilds the list around the same rows and the highlight stays where
   * it stood, while a narrowed query takes its row away and the highlight
   * starts over. A popup that opened searching holds the highlight for the
   * first row before any row stands, and keeps it there.
   */
  const publishRows = useCallback((next: readonly ChooserRow[]) => {
    const { rows: previous, highlight: at } = latest.current;
    const held = previous[clampedHighlight(at, previous.length)]?.value ?? null;
    setRows(next);
    setHighlight(
      previous.length === 0 && at >= 0 ? 0 : rehomedHighlight(held, next),
    );
  }, []);

  const optionId = useCallback(
    (index: number) => `${popupId}-option-${index}`,
    [popupId],
  );
  const active = clampedHighlight(highlight, rows.length);

  /**
   * One scope per open, parented to the app scope so every key it leaves
   * alone — Escape on the rows included, which stays the platform's — reaches Obsidian's
   * own hotkeys.
   */
  const [scope] = useState(() => new Scope(app.scope));
  const activeValue = useCallback(() => {
    const { rows: shown, highlight: at } = latest.current;
    return shown[clampedHighlight(at, shown.length)]?.value ?? null;
  }, []);

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
    // While a page stands, the keys of the rows leave its fields alone.
    const move = (step: ChooserMove) => (event: KeyboardEvent) => {
      if (composing(event) || latest.current.page !== null) return;
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
      if (latest.current.page !== null) return commitField();
      const {
        rows: shown,
        highlight: at,
        selected: ticked,
        onValueChange: emit,
      } = latest.current;
      const row = shown[clampedHighlight(at, shown.length)];
      runActivation(activatedRow(row, ticked), close, emit);
      return false;
    };
    // On a page, Enter saves the text field it was typed in, as a Bases menu
    // page saves on blur, and submits the form the field stands in. A key
    // anywhere else on the page stays its own.
    const commitField = () => {
      // The key reaches the field that holds focus.
      const field = popupRef.current?.doc.activeElement;
      if (
        !field?.instanceOf(HTMLInputElement) ||
        !["text", "search"].includes(field.type) ||
        !popupRef.current?.contains(field)
      )
        return;
      // Focus moves to the page itself, which saves the field as it blurs
      // and keeps the keys inside the popup.
      field.closest<HTMLElement>("[data-chooser-page]")?.focus();
      field.form?.requestSubmit();
      return false;
    };
    // On the rows, Escape is the popover's own light dismiss, which a
    // handler returning `false` would suppress, so it falls through. On a
    // page, it steps back to the rows. A layer standing over the page — its
    // `PageMenu`, or a field's own popup such as a Formula's completion list
    // or Signature Hint — pushes a Scope above this one while it stands, so
    // its Escape never reaches here.
    const escape = (event: KeyboardEvent) => {
      if (composing(event) || latest.current.page === null) return;
      back();
      return false;
    };
    // Ctrl-P and Ctrl-N repeat the arrows, the way every Obsidian list
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
    stack.use(registerKeymap(scope, [], "Escape", escape));
    // ArrowRight is the one registered key that can fall through: on a row
    // with a page of its own it opens that page, and anywhere else it stays
    // the search field's caret key.
    stack.use(
      registerKeymap(scope, [], "ArrowRight", (event) => {
        if (composing(event) || latest.current.page !== null) return;
        const { rows: shown, highlight: at } = latest.current;
        const next =
          at < 0 ? undefined : shown[clampedHighlight(at, shown.length)]?.next;
        if (!next) return;
        next(close);
        return false;
      }),
    );
    return () => stack.dispose();
  }, [scope, close, listRef, popupRef, back]);

  /**
   * Pushed when the session mounts and popped when it unmounts, so the
   * Chooser holds the keyboard exactly while the popup is open and a closed
   * one is inert.
   */
  useLayoutEffect(() => {
    app.keymap.pushScope(scope);
    return () => app.keymap.popScope(scope);
  }, [app, scope]);

  // An open from outside the popup reaches the session while it stands.
  useLayoutEffect(() => {
    sessionPage.current = openPage;
    return () => {
      sessionPage.current = null;
    };
  }, [sessionPage, openPage]);

  // Back on the rows, focus returns to the search field, or the list box
  // when there is none, so the keys reach the rows again.
  const onPage = useRef(page !== null);
  useLayoutEffect(() => {
    const was = onPage.current;
    onPage.current = page !== null;
    if (!was || page !== null) return;
    const popup = popupRef.current;
    (popup?.querySelector<HTMLElement>("input") ?? listRef.current)?.focus();
  }, [page, popupRef, listRef]);

  const session = useMemo<ChooserSessionState>(
    () => ({
      query,
      setQuery,
      publishRows,
      highlightRow: setHighlight,
      optionId,
      active,
      activeOptionId: active < 0 ? null : optionId(active),
      scope,
      activeValue,
      page,
      openPage,
      back,
      replacePage,
    }),
    [
      query,
      setQuery,
      publishRows,
      optionId,
      active,
      scope,
      activeValue,
      page,
      openPage,
      back,
      replacePage,
    ],
  );

  return (
    <ChooserSessionContext value={session}>{children}</ChooserSessionContext>
  );
}

export interface ChooserTriggerProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "popoverTarget" | "type"
> {
  ref?: Ref<HTMLButtonElement>;
  /**
   * A trigger with nothing to choose from keeps its seat and its place in the
   * tab order, carries its reason in its tooltip, and opens nothing, as a
   * blocked `IconButton` does.
   */
  blocked?: boolean;
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
function Trigger({
  className,
  style,
  ref,
  blocked,
  onClick,
  ...rest
}: ChooserTriggerProps) {
  const { anchorName, popupId, open, listId } = useChooser();
  return (
    <button
      ref={ref}
      type="button"
      popoverTarget={popupId}
      aria-expanded={open}
      // A trigger that stands as a combobox names the list box it controls,
      // which stands only while the popup is open.
      aria-controls={rest.role === "combobox" && open ? listId : undefined}
      aria-disabled={blocked || undefined}
      data-open={open ? "" : undefined}
      {...rest}
      // A native `disabled` would drop the trigger from the tab order and
      // from the pointer events Obsidian's tooltip reads, so a blocked
      // trigger cancels the click instead: that cancels the popover invoker
      // too, for a press from the keyboard as from the pointer.
      onClick={(e) => {
        if (blocked) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={cn(
        themeHook.chooserTrigger,
        "zt:group zt:[anchor-name:var(--zt-chooser-anchor)]",
        "zt:aria-disabled:cursor-default zt:aria-disabled:opacity-50",
        className,
      )}
      style={{ "--zt-chooser-anchor": anchorName, ...style } as CSSProperties}
    />
  );
}

export interface ChooserPopupProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "id" | "popover" | "onToggle" | "onBeforeToggle"
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
 *
 * The root does not clip, so an editor's tooltip drawn in it, such as a
 * Formula page's, reaches past its edge; its rows and its pages scroll in
 * boxes of their own.
 */
function Popup({
  className,
  style,
  ref,
  children,
  ...rest
}: ChooserPopupProps) {
  const { anchorName, popupId, popupRef, setOpen, open, listRef } =
    useChooser();
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

  /**
   * `beforetoggle` mounts and unmounts the session. The browser sends it
   * before the popup shows, so the first frame the popup paints already
   * holds the new session's empty search and fresh rows.
   *
   * `toggle` moves DOM focus into the popup once it shows, because the
   * highlight is named by whatever element holds focus: a screen reader
   * follows the active descendant of the focused element, and Enter on a
   * trigger that kept focus is the invoker press that shuts the popup again.
   * The search field takes focus when the caller rendered one; the list box
   * takes it otherwise, which is why the list carries a programmatic tab
   * index. The search part is optional, so the highlight cannot depend on it
   * to have an owner. Focus waits for `toggle` because a popup that is not
   * yet shown cannot take it.
   *
   * Both are listened to here rather than through JSX props, so they reach
   * the element under every DOM the component renders in.
   *
   * Preact renders the unmount inside the `beforetoggle` listener, so by the
   * time a caller's own bubbling listener runs, the search field is gone and
   * focus has dropped to the body. A caller that acts on the focus a closing
   * popup holds, as the Select hands it back to its trigger, listens in the
   * capture phase.
   */
  useLayoutEffect(() => {
    const popup = popupRef.current;
    if (!popup) return;
    const onBeforeToggle = (event: Event) =>
      setOpen((event as ToggleEvent).newState === "open");
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState !== "open") return;
      // A popup that opened on a page has focused that page's field already.
      if (popup.contains(popup.doc.activeElement)) return;
      const field = popup.querySelector<HTMLElement>("input");
      (field ?? listRef.current)?.focus();
    };
    popup.addEventListener("beforetoggle", onBeforeToggle);
    popup.addEventListener("toggle", onToggle);
    return () => {
      popup.removeEventListener("beforetoggle", onBeforeToggle);
      popup.removeEventListener("toggle", onToggle);
    };
  }, [popupRef, setOpen, listRef]);

  return (
    <div
      ref={attach}
      id={popupId}
      popover="auto"
      {...rest}
      className={cn(
        themeHook.chooser,
        "zt:inset-auto zt:my-1 zt:[max-height:min(--spacing(75),calc(100%_-_--spacing(2)))] zt:max-w-80 zt:min-w-50 zt:flex-col zt:[&:popover-open]:flex",
        tooltipHostRoot,
        // No padding of its own: the search field runs edge to edge over its
        // rule, and the list carries the inset — `--menu-padding` — as
        // Obsidian's Bases toolbar menus are built.
        "zt:border-(length:--menu-border-width) zt:border-(--menu-border-color) zt:bg-(--menu-background) zt:text-foreground zt:shadow-(--menu-shadow)",
        "zt:rounded-(--menu-radius) zt:[corner-shape:var(--menu-corner-shape)]",
        "zt:[position-anchor:var(--zt-chooser-anchor)] zt:[position-area:block-end_span-inline-end] zt:[position-try-fallbacks:flip-block]",
        className,
      )}
      style={{ "--zt-chooser-anchor": anchorName, ...style } as CSSProperties}
    >
      {open && <ChooserSession>{children}</ChooserSession>}
    </div>
  );
}

export interface ChooserInputProps {
  placeholder: string;
  clearLabel: string;
}

/**
 * The search field. The query lives in the session's state; this part reads it
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
 * screen reader reads the pair as. The popup moves focus here on open rather
 * than this part claiming it, because a Chooser without a search field has to
 * hand the highlight another owner.
 *
 * It is a text field rather than a search field so that Escape stays the
 * platform's: a search field answers Escape itself by clearing its query, and
 * the popup's light dismiss then never sees the key while a query stands.
 */
function Input({ placeholder, clearLabel }: ChooserInputProps) {
  const { open, listId } = useChooser();
  const { query, setQuery, activeOptionId, page } = useChooserSession();
  if (page !== null) return null;
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
  "children" | "aria-label" | "aria-labelledby"
> {
  /**
   * What the list box is called. Required rather than optional: a list box
   * carries no name of its own, and an unnamed one is announced as a bare
   * "list box" — the caller is the only one that knows whether its rows are
   * tags or colours. It reaches the list box through `aria-labelledby` and a
   * hidden element, since Obsidian shows a container's `aria-label` as a
   * hover tooltip over every row.
   */
  label: string;
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
  label,
  groups,
  emptyLabel,
  children,
  className,
  ...rest
}: ChooserListProps<Row>) {
  const { listId, listRef } = useChooser();
  const { query, active, activeOptionId, optionId, publishRows, page } =
    useChooserSession();
  const { sections, rows, empty } = useMemo(
    () => chooserLayout(groups, query ? prepareFuzzySearch(query) : null),
    [groups, query],
  );

  // The keys are registered on the session, so the rows they move over have to
  // reach it. The list is where the query filter runs, so it is the only part
  // that knows them; where the highlight then lands is the session's to say.
  // A page keeps the rows it covers, so the highlight is where it was when
  // the user steps back.
  useLayoutEffect(() => {
    if (page === null) publishRows(rows);
  }, [rows, publishRows, page]);

  const scrolled = sections.filter((section) => !section.pinned);
  const pinned = sections.filter((section) => section.pinned);
  /** Groups drawn one after another, a rule between each two. */
  const drawSections = (drawn: typeof sections, footer = false) =>
    drawn.map((section, index) => (
      <Fragment key={section.groupIndex}>
        {(index > 0 || (empty && !footer)) && <Separator />}
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
    ));

  const list = useMemo<ChooserListState>(
    () => ({
      indexOf: new Map(rows.map((row, index) => [row.value, index])),
      rows,
      active,
      optionId,
    }),
    [rows, active, optionId],
  );

  if (page !== null) return null;
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
      <span id={`${listId}-label`} hidden>
        {label}
      </span>
      {/* The tab index is programmatic: the popup focuses this element when the
          caller rendered no search field, and a Chooser still holds exactly
          one tab stop either way. */}
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-labelledby={`${listId}-label`}
        tabIndex={-1}
        aria-multiselectable
        aria-activedescendant={activeOptionId ?? undefined}
        {...rest}
        className={cn(
          pinned.length === 0
            ? "zt:min-h-0 zt:flex-1 zt:overflow-y-auto zt:p-(--menu-padding)"
            : "zt:flex zt:min-h-0 zt:flex-1 zt:flex-col",
          className,
        )}
      >
        <ChooserListContext value={list}>
          {pinned.length === 0 ? (
            drawSections(scrolled)
          ) : (
            <>
              {/* The rows scroll in a box of their own, and the pinned groups
                  stand under it below a rule, as the actions group of a
                  Bases menu does. Both boxes are presentation: their rows are
                  the list box's own options. */}
              <div
                role="presentation"
                data-chooser-scroll=""
                className="zt:min-h-0 zt:flex-1 zt:overflow-y-auto zt:p-(--menu-padding)"
              >
                {drawSections(scrolled)}
              </div>
              <div
                role="presentation"
                data-chooser-pinned=""
                className="zt:shrink-0 zt:border-t-(length:--border-width) zt:border-border zt:p-(--size-4-1)"
              >
                {drawSections(pinned, true)}
              </div>
            </>
          )}
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
  const { selected, onValueChange, close } = useChooser();
  const { highlightRow } = useChooserSession();
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
    // The row a Bases toolbar menu draws, from the variables it reads:
    // `--size-2-2` of padding, `--size-2-3` before the mark, a `--size-4-2`
    // gap between the mark and the name.
    "zt:flex zt:cursor-clickable zt:items-center zt:gap-(--size-4-2) zt:rounded-sm zt:p-(--size-2-2) zt:ps-(--size-2-3) zt:text-sm",
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
  /**
   * What the row draws in the glyph's place when one glyph is not enough,
   * such as a checkbox and a type icon. The row's `aria-selected` still
   * reports its state.
   */
  leading?: ReactNode;
  /** Trailing content after the label, such as a chevron to the row's page. */
  end?: ReactNode;
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
  leading,
  end,
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
      {leading ?? (
        <Icon
          name={icon ?? "check"}
          size="s"
          className={cn("zt:shrink-0", !icon && "zt:invisible")}
        />
      )}
      <span className={cn("zt:truncate", end && "zt:min-w-0 zt:flex-1")}>
        {children}
      </span>
      {end}
    </div>
  );
}

export interface ChooserItemProps
  extends HTMLAttributes<HTMLDivElement>, Pick<RowShellProps, "leading"> {
  /**
   * Which published row this draws. Everything else about the row — whether it
   * is disabled, and whether it ticks or runs — travels with the row itself,
   * so the pointer and the keyboard read one flag rather than two.
   */
  value: string;
  /**
   * The glyph in the tick's place, drawn whether or not the row is ticked,
   * such as a view's layout icon. The row still reports its tick through
   * `aria-selected` and `data-selected`.
   */
  icon?: IconName;
  /** Trailing content after the label, such as a chevron to the row's page. */
  end?: ReactNode;
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
 * as parts inside it. There are none: a row is a leading glyph, one line of
 * label and optional trailing content in that order, always, and the two parts
 * exist to let a caller reorder or restyle a pair this one draws itself. The
 * caller's children are the label; the glyph is the tick unless the caller
 * names an `icon`.
 *
 * It stays a separate part from {@link Action} rather than one row component
 * with a flag: the two say different things — one ticks and reports
 * `aria-selected`, the other runs and reports none. What they draw the same is
 * drawn once, in {@link RowShell}.
 */
function Item({ value, icon, ...rest }: ChooserItemProps) {
  const { selected } = useChooser();
  const ticked = selected.includes(value);

  return (
    <RowShell
      value={value}
      selected={ticked}
      icon={icon ?? (ticked ? "check" : undefined)}
      data-selected={ticked ? "" : undefined}
      {...rest}
    />
  );
}

export interface ChooserActionProps
  extends HTMLAttributes<HTMLDivElement>, Pick<RowShellProps, "leading"> {
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

export interface ChooserPageProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  /** The content of the page on screen, from the name it was opened with. */
  children: (page: string) => ReactNode;
}

/**
 * A page that stands in the place of the search field and the rows, as a
 * Bases toolbar menu steps from a row to that row's page: a
 * {@link PageHeader}, then the page's own fields. Escape and the header's
 * back button step back to the rows, with the highlight where it was.
 *
 * Its first field takes focus with its text selected, so the user can type
 * over it at once; a page with no field takes focus itself, so the keys
 * still reach the popup. A page unmounts with no blur event, when the user
 * steps back or the popup closes, so a field that saves on blur saves as it
 * unmounts too.
 */
function Page({ children, ...rest }: ChooserPageProps) {
  const { page } = useChooserSession();
  if (page === null) return null;
  // A page of its own per name, so a replaced page starts fresh.
  return (
    <PageBody key={page} {...rest}>
      {children(page)}
    </PageBody>
  );
}

function PageBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  // The page's own parts lay out their fields in layout effects too, and a
  // child's runs before its parent's, so the fields stand by now.
  useLayoutEffect(() => {
    const page = ref.current;
    const field = page?.querySelector<HTMLElement>(
      "input:not([type=checkbox]):not([type=range]), textarea, select",
    );
    (field ?? page)?.focus();
    if (
      field?.instanceOf(HTMLInputElement) ||
      field?.instanceOf(HTMLTextAreaElement)
    )
      field.select();
  }, []);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-chooser-page=""
      {...rest}
      className={cn(
        "zt:flex zt:min-h-0 zt:flex-col zt:overflow-y-auto zt:outline-none",
        className,
      )}
    />
  );
}

/**
 * Runs `save` as a page leaves, when the user steps back or the popup closes.
 * A page leaves the DOM with no blur event, so a field that saves on blur
 * saves once more on its way out; `save` is a no-op when nothing changed.
 */
export function useChooserPageSave(save: () => void): void {
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => () => latest.current(), []);
}

/**
 * The text of a page's field, with the text the last input event left. A
 * save reads `typed`: a key, or the page leaving, can land before the render
 * that follows the typing.
 */
export function useChooserPageText(
  initial: string,
): [text: string, setText: (next: string) => void, typed: RefObject<string>] {
  const [text, setTextState] = useState(initial);
  const typed = useRef(initial);
  const setText = useCallback((next: string) => {
    typed.current = next;
    setTextState(next);
  }, []);
  return [text, setText, typed];
}

/**
 * What a page shows once its subject leaves the file, such as a view another
 * pane deleted: it steps back to the page under it.
 */
function PageGone() {
  const { back } = useChooserSession();
  useLayoutEffect(() => back(), [back]);
  return null;
}

/**
 * An icon button inside a Chooser, such as a row's chevron or a page's close
 * button, drawn from the variables Obsidian draws a clickable icon with. It
 * stays a bare `<button>`, its Obsidian button box rolled back in
 * `chooser.css`: the `…` button opens its menu as the menu's popover
 * invoker, which only a `<button>` can be, and the `IconButton` wrapper is a
 * `<div>`.
 */
export const chooserIconButton =
  "zt-chooser-icon zt:flex zt:shrink-0 zt:cursor-(--cursor) zt:items-center zt:justify-center zt:rounded-(--clickable-icon-radius) zt:[corner-shape:var(--corner-shape)] zt:px-(--size-2-3) zt:py-(--size-2-2) zt:text-(--icon-color) zt:hover:bg-(--background-modifier-hover) zt:hover:text-(--icon-color-hover) zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:focus-visible:outline-none zt:[&_svg]:opacity-(--icon-opacity) zt:hover:[&_svg]:opacity-(--icon-opacity-hover)";

export interface ChooserPageHeaderProps {
  /** The page's title, such as "Configure view". */
  title: string;
  /** The tooltip of the back button. */
  backLabel: string;
  /** The tooltip of the close button. */
  closeLabel: string;
  /** Buttons before the close button, such as a {@link PageMenu}. */
  actions?: ReactNode;
}

/**
 * The header of a page, as a Bases toolbar menu draws it: a back button that
 * carries the page's title, the page's actions, and a button that closes the
 * popup. The back button is a menu row rather than a button, so it stays a
 * bare `<button>` drawn by its utilities, as the trigger is: the `Button`
 * wrapper would bring the button box this row takes back off.
 */
function PageHeader({
  title,
  backLabel,
  closeLabel,
  actions,
}: ChooserPageHeaderProps) {
  const { close } = useChooser();
  const { back } = useChooserSession();
  return (
    <div
      data-chooser-page-header=""
      className="zt:flex zt:shrink-0 zt:items-center zt:gap-(--size-4-1) zt:p-(--size-4-1)"
    >
      <button
        type="button"
        className="zt-chooser-page-back zt:flex zt:min-w-0 zt:flex-1 zt:cursor-(--cursor) zt:items-center zt:gap-(--size-4-1) zt:rounded-(--radius-s) zt:p-(--size-2-2) zt:text-(length:--font-ui-small) zt:[font-weight:var(--font-medium)] zt:text-foreground zt:hover:bg-(--background-modifier-hover)"
        data-chooser-page-back=""
        {...tooltipAttrs(backLabel)}
        onClick={back}
      >
        <Icon
          name="chevron-left"
          size="s"
          className="zt:shrink-0 zt:text-muted-foreground"
        />
        <span className="zt:truncate">{title}</span>
      </button>
      {actions}
      <button
        type="button"
        className={chooserIconButton}
        data-chooser-page-close=""
        {...tooltipAttrs(closeLabel)}
        onClick={close}
      >
        <Icon name="x" size="s" />
      </button>
    </div>
  );
}

/** The fields of a page, stacked as the form of a Bases menu page. */
function PageForm({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        "zt:flex zt:flex-col zt:gap-(--size-4-2) zt:px-(--size-4-2) zt:pt-(--size-4-1) zt:pb-(--size-4-2) zt:text-(length:--font-ui-small)",
        className,
      )}
    />
  );
}

export interface ChooserPageFieldProps {
  label: string;
  /** A line under the label, such as what the field sets or what is wrong. */
  description?: ReactNode;
  /** Draws the description in the error colour. */
  invalid?: boolean;
  /** A line under the control, such as the verdict on a formula's text. */
  after?: ReactNode;
  /**
   * Puts the control beside the label rather than under it, as a toggle
   * stands. A field of that kind is no `<label>`, so a click on its text
   * does not reach the control twice.
   */
  inline?: boolean;
  children: ReactNode;
}

/**
 * One field of a page: its label, a line under it, and its control, stacked
 * as the fields of a Bases menu page are.
 */
function PageField({
  label,
  description,
  invalid,
  inline,
  after,
  children,
}: ChooserPageFieldProps) {
  const Field = inline ? "div" : "label";
  return (
    <Field
      className={cn(
        "zt:flex zt:gap-(--size-2-2)",
        inline ? "zt:items-center zt:justify-between" : "zt:flex-col",
      )}
    >
      <span className="zt:flex zt:min-w-0 zt:flex-col zt:gap-0.5">
        <span className="zt:text-foreground">{label}</span>
        {description && (
          <span
            className={cn(
              "zt:text-xs",
              invalid ? "zt:text-(--text-error)" : "zt:text-muted-foreground",
            )}
          >
            {description}
          </span>
        )}
      </span>
      {inline ? (
        children
      ) : (
        // The control grows to the field's width, as a Bases menu page
        // lays it out: Obsidian gives a slider a fixed width, which a flex
        // basis outranks.
        <span className="zt:flex zt:min-h-(--input-height) zt:items-center zt:*:min-w-0 zt:*:flex-1">
          {children}
        </span>
      )}
      {after}
    </Field>
  );
}

export interface ChooserPageMenuItem {
  title: string;
  icon: IconName;
  /** Draws a tick after the title, such as the view that opens first. */
  checked?: boolean;
  /** Draws the item in the warning colour, after a rule, as a delete is. */
  warning?: boolean;
  disabled?: boolean;
  /** A `data-*` hook for the item. */
  hook?: string;
  onSelect: () => void;
}

export interface ChooserPageMenuProps {
  /** The tooltip of the button. */
  label: string;
  items: readonly ChooserPageMenuItem[];
}

/**
 * The "…" button of a page and the menu it opens, as a Bases menu page
 * offers its page's actions. An Obsidian `Menu` paints under the popup's top
 * layer, so the menu is a popover of its own, nested in the popup: the
 * platform keeps the popup open while it stands, and Escape or a click
 * outside it closes it alone.
 *
 * While the menu stands, a Scope of its own sits above the Chooser's, so the
 * Chooser's keys — Escape stepping back from the page among them — never hear
 * a key meant for the menu. It registers nothing: Escape falls to the app
 * scope it is parented to, and the light dismiss closes the menu alone. It is
 * pushed as the menu opens, from the gesture in the window that holds the
 * popup, and popped as the menu closes or unmounts.
 */
function PageMenu({ label, items }: ChooserPageMenuProps) {
  const app = useObsidianApp();
  const id = useUniqueId();
  const menu = useRef<HTMLDivElement>(null);
  // `beforetoggle`, not `toggle`: the browser queues `toggle` after the menu
  // shows, and a key arriving first would reach the Chooser.
  useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    const scope = new Scope(app.scope);
    let pushed = false;
    const release = () => {
      if (pushed) app.keymap.popScope(scope);
      pushed = false;
    };
    const onBeforeToggle = (event: ToggleEvent) => {
      if (event.newState !== "open") return release();
      if (pushed) return;
      app.keymap.pushScope(scope);
      pushed = true;
    };
    el.addEventListener("beforetoggle", onBeforeToggle);
    return () => {
      el.removeEventListener("beforetoggle", onBeforeToggle);
      release();
    };
  }, [app]);
  const anchor = { "--zt-chooser-menu-anchor": `--${id}` } as CSSProperties;
  return (
    <>
      <button
        type="button"
        id={`${id}-button`}
        popoverTarget={id}
        className={cn(
          chooserIconButton,
          "zt:[anchor-name:var(--zt-chooser-menu-anchor)]",
        )}
        data-chooser-page-menu=""
        {...tooltipAttrs(label)}
        style={anchor}
      >
        <Icon name="more-horizontal" size="s" />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="menu"
        // Named by its button: an `aria-label` would show a tooltip.
        aria-labelledby={`${id}-button`}
        className={cn(
          "zt:inset-auto zt:my-1 zt:min-w-45 zt:flex-col zt:p-(--size-4-1) zt:[&:popover-open]:flex",
          "zt:border-(length:--menu-border-width) zt:border-(--menu-border-color) zt:bg-(--menu-background) zt:text-foreground zt:shadow-(--menu-shadow)",
          "zt:rounded-(--menu-radius) zt:[corner-shape:var(--menu-corner-shape)]",
          "zt:[position-anchor:var(--zt-chooser-menu-anchor)] zt:[position-area:block-end_span-inline-start] zt:[position-try-fallbacks:flip-block,flip-inline,flip-block_flip-inline]",
        )}
        style={anchor}
      >
        {items.map((item, index) => (
          <Fragment key={item.title}>
            {item.warning && index > 0 && !items[index - 1]!.warning && (
              <Separator />
            )}
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              data-chooser-page-menu-item={item.hook}
              className={cn(
                "zt-chooser-page-menu-item",
                rowBox(item.disabled ?? false, "zt:w-full zt:text-start"),
                item.warning && !item.disabled && "zt:text-(--text-error)",
              )}
              onClick={() => {
                menu.current?.hidePopover();
                item.onSelect();
              }}
            >
              <Icon name={item.icon} size="s" className="zt:shrink-0" />
              <span className="zt:min-w-0 zt:flex-1 zt:truncate">
                {item.title}
              </span>
              {item.checked && (
                <Icon name="check" size="s" className="zt:shrink-0" />
              )}
            </button>
          </Fragment>
        ))}
      </div>
    </>
  );
}

Chooser.Trigger = Trigger;
Chooser.Popup = Popup;
Chooser.Input = Input;
Chooser.List = List;
Chooser.Item = Item;
Chooser.Action = Action;
Chooser.Page = Page;
Chooser.PageHeader = PageHeader;
Chooser.PageForm = PageForm;
Chooser.PageField = PageField;
Chooser.PageGone = PageGone;
Chooser.PageMenu = PageMenu;
