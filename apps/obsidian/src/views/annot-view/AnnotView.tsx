import type { IconName } from "obsidian";
import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";

import { Button } from "@/components/obsidian/button";
import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import { SearchInput } from "@/components/obsidian/search-input";
import * as m from "@/lib/i18n/generated/messages";
import { tooltipAttrs } from "@/lib/utils";

import { AnnotActionsContext } from "./actions";
import { Annotation } from "./Annotation";
import { capabilityBlock } from "./card-controls";
import { filterAnnotations, isFilterActive } from "./filter";
import { FilterBar } from "./FilterBar";
import { annotViewBody, headerShape } from "./presentation";
import type {
  AnnotViewBody,
  EmptyStateAction,
  HeaderShape,
} from "./presentation";
import {
  useAnnotFilter,
  useAnnotStore,
  useClearFilters,
  useCloseDrawer,
  useSetFilterQuery,
  useToggleSearchOpen,
} from "./store";

/**
 * Each shape `presentation.ts` derives is a fresh object, and the store is read
 * through `useSyncExternalStore`, which compares snapshots by identity — a
 * selector that builds one on every call never settles. So each is built from
 * the slices it depends on and held while those are unchanged.
 */
function useHeaderShape(): HeaderShape {
  const attachments = useAnnotStore((s) => s.attachments);
  const selectedAttachmentKey = useAnnotStore((s) => s.selectedAttachmentKey);
  const attachmentLock = useAnnotStore((s) => s.attachmentLock);
  const capability = useAnnotStore((s) => s.capability);
  const followMode = useAnnotStore((s) => s.followMode);
  const itemDisplay = useAnnotStore((s) => s.itemDisplay);
  const zoteroReaderClosed = useAnnotStore((s) => s.zoteroReaderClosed);
  return useMemo(
    () =>
      headerShape({
        attachments,
        selectedAttachmentKey,
        attachmentLock,
        capability,
        followMode,
        itemDisplay,
        zoteroReaderClosed,
      }),
    [
      attachments,
      selectedAttachmentKey,
      attachmentLock,
      capability,
      followMode,
      itemDisplay,
      zoteroReaderClosed,
    ],
  );
}

function useBody(): AnnotViewBody {
  const attachments = useAnnotStore((s) => s.attachments);
  const annotations = useAnnotStore((s) => s.annotations);
  const followMode = useAnnotStore((s) => s.followMode);
  const liveUpdatesOn = useAnnotStore((s) => s.liveUpdatesOn);
  const pinnedItemKey = useAnnotStore((s) => s.pinnedItemKey);
  return useMemo(
    () =>
      annotViewBody({
        attachments,
        annotations,
        followMode,
        liveUpdatesOn,
        pinnedItemKey,
      }),
    [attachments, annotations, followMode, liveUpdatesOn, pinnedItemKey],
  );
}

export function AnnotView() {
  const searchOpen = useAnnotStore((s) => s.searchOpen);
  const body = useBody();
  /**
   * Collapse is this view's own display state rather than part of the filter:
   * nothing outside the pane reads it and nothing persists it, so it stays
   * here and reaches the control row as a prop.
   */
  const [collapsed, setCollapsed] = useState(true);
  const searchBarId = useId();
  /** Where Escape in the search bar sends focus, the button that opened it. */
  const searchButtonRef = useRef<HTMLDivElement>(null);

  const hasItem = body.kind === "list" || body.kind === "loading";

  return (
    // `relative` is the drawer's own frame: it sits over the list at the pane's
    // bottom edge, so nothing it says can reflow what the reader is scanning.
    <div className="zt:@container zt:relative zt:flex zt:h-full zt:flex-col zt:overflow-hidden">
      <AnnotHeader />
      {hasItem && (
        <FilterBar
          searchBarId={searchBarId}
          searchButtonRef={searchButtonRef}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
        />
      )}
      {hasItem && searchOpen && (
        <SearchRow id={searchBarId} searchButtonRef={searchButtonRef} />
      )}
      {body.kind === "list" ? (
        <AnnotList collapsed={collapsed} />
      ) : body.kind === "loading" ? (
        <div className="pane-empty zt:p-2">{m.annot_view_loading()}</div>
      ) : body.kind === "no-attachments" ? (
        <div className="pane-empty zt:p-2">{body.message}</div>
      ) : (
        <EmptyPane message={body.message} action={body.action} />
      )}
      <CapabilityDrawer />
    </div>
  );
}

/**
 * Why the verb just pressed could not act, at the pane's bottom edge and over
 * the list. One drawer per view, and what it states is the Editing Capability
 * in force rather than the one a press found: authorizing, a cooldown counting
 * down and editing coming back all move the sentence and the action under the
 * open drawer.
 *
 * It is a labelled section rather than a dialog: it interrupts nothing, the
 * list behind it stays live, and the keyboard is offered rather than trapped.
 * Focus moves into it on open so the sentence is announced where it happened,
 * and Escape or Close hands the keyboard back to the verb that opened it.
 *
 * The content it last held survives the close, so the exit transition has
 * something to carry out; `inert` keeps the closed shape out of the keyboard's
 * and assistive technology's way while it does.
 */
function CapabilityDrawer() {
  const open = useAnnotStore((s) => s.drawerOpen);
  const opener = useAnnotStore((s) => s.drawerOpener);
  const capability = useAnnotStore((s) => s.capability);
  const closeDrawer = useCloseDrawer();
  const actions = useContext(AnnotActionsContext);
  const labelId = useId();
  const panel = useRef<HTMLElement>(null);
  // Read as the cards read it: the instant the state it speaks about last
  // moved, so a cooldown's remaining seconds are the ones that state left.
  const block = useMemo(
    () => capabilityBlock(capability, Temporal.Now.instant()),
    [capability],
  );
  const shown = useRef(block);
  if (block) shown.current = block;

  useEffect(() => {
    if (open) {
      panel.current?.focus();
      return;
    }
    // A drawer that closed by itself can hold the keyboard while it goes inert,
    // which would drop focus to the body. Hand it back to the verb first.
    const el = panel.current;
    if (el && el.contains(el.doc.activeElement)) opener.current?.focus();
    opener.current = null;
  }, [open, opener]);

  const content = shown.current;
  if (!content) return null;

  /** Close, and hand the keyboard back to the verb that opened this. */
  const dismiss = (): void => {
    const verb = opener.current;
    closeDrawer();
    verb?.focus();
  };

  return (
    <section
      ref={panel}
      tabIndex={-1}
      inert={!open}
      aria-labelledby={labelId}
      data-open={open ? "" : undefined}
      // Neutral chrome: the raised fill the cards wear, one step of shadow, and
      // no alert colour — a capability that refuses writes is a state, not a
      // fault. The static shape is the whole message; motion only carries it in,
      // and `starting:` is what gives the first open the same entry as the rest,
      // since that one mounts the element already open.
      className="zt:invisible zt:absolute zt:inset-x-2 zt:bottom-2 zt:flex zt:translate-y-1 zt:flex-col zt:gap-2 zt:rounded-md zt:bg-card zt:p-2 zt:text-xs zt:opacity-0 zt:shadow-md zt:ring-1 zt:ring-border zt:duration-150 zt:ease-out zt:data-open:visible zt:data-open:translate-y-0 zt:data-open:opacity-100 zt:motion-safe:transition-[opacity,translate,visibility] zt:starting:translate-y-1 zt:starting:opacity-0"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // Obsidian's own Escape would otherwise act on the pane behind this.
        event.stopPropagation();
        dismiss();
      }}
    >
      <div className="zt:flex zt:items-start zt:gap-2">
        <p id={labelId} className="zt:min-w-0 zt:flex-1 zt:text-pretty">
          {content.reason}
        </p>
        <IconButton
          icon="x"
          className="zt:-me-1 zt:-mt-1"
          onClick={dismiss}
          {...tooltipAttrs(m.annot_view_drawer_close())}
        />
      </div>
      {content.action === "allow-editing" && (
        <div className="zt:flex zt:justify-end">
          <Button onClick={() => actions.onAllowEditing()}>
            {m.capability_enable_editing()}
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * The header block: one press target opening one grouped menu, in the two
 * shapes `headerShape` leaves it. Everything it reports — the mode, the
 * Attachment count, the read-only state, a closed reader — is inert text
 * inside that one target, so the block takes one hover shape and one focus
 * stop however much it has to say.
 *
 * @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md
 */
function AnnotHeader() {
  const actions = useContext(AnnotActionsContext);
  const shape = useHeaderShape();
  const labelId = useId();

  return (
    <div className="zt:px-2 zt:pt-2">
      <button
        type="button"
        aria-haspopup="menu"
        aria-labelledby={labelId}
        onClick={(evt) => actions.onHeaderMenu(evt)}
        className="zt-annot-header zt:inline-flex zt:max-w-full zt:items-center zt:gap-2 zt:rounded-sm zt:px-1.5 zt:py-1 zt:text-start zt:hover:bg-card zt:hover:ring-1 zt:hover:ring-border zt:focus-visible:bg-card zt:focus-visible:ring-2 zt:focus-visible:ring-border-focus"
      >
        {/* The name the block promises assistive technology, held apart from
            the words on screen: an `aria-label` would reach the pointer too,
            and Obsidian would draw the whole sentence as a hover tooltip.
            @see apps/obsidian/policies/tooltips.md */}
        <span id={labelId} className="zt:sr-only">
          {shape.label}
        </span>
        <span className="zt:flex zt:min-w-0 zt:flex-col zt:gap-0.5">
          {shape.kind === "masthead" ? (
            <Masthead shape={shape} />
          ) : (
            <StatusBar shape={shape} />
          )}
        </span>
        {/* The chevron belongs to the block, not to any word in it: its own
            inline-end lane beside the text, so it stays by the words however
            wide the pane grows, and no wrapped byline segment runs under it. */}
        <ChromeIcon name="chevron-down" />
      </button>
    </div>
  );
}

/** The Item over its byline, with the Follow Mode carried by its glyph alone. */
function Masthead({
  shape,
}: {
  shape: Extract<HeaderShape, { kind: "masthead" }>;
}) {
  return (
    <>
      <span className="zt:flex zt:min-w-0 zt:items-center zt:gap-1">
        <ChromeIcon name={shape.modeIcon} />
        <span className="zt:min-w-0 zt:text-sm zt:font-semibold zt:text-balance">
          {shape.title}
        </span>
      </span>
      {shape.byline.length > 0 && <Byline segments={shape.byline} />}
    </>
  );
}

/** The Follow Mode in full, with whatever the pane has to report after it. */
function StatusBar({
  shape,
}: {
  shape: Extract<HeaderShape, { kind: "status-bar" }>;
}) {
  return (
    <span className="zt:flex zt:min-w-0 zt:items-center zt:gap-1">
      <ChromeIcon name={shape.modeIcon} />
      <Byline segments={[shape.modeLabel, ...shape.indicators]} />
    </span>
  );
}

/**
 * A glyph in the header's chrome: the mode's own icon and the block's
 * chevron, at the `--icon-xs` Obsidian sets beside its own 13px text, in the
 * byline's ink.
 */
function ChromeIcon({ name }: { name: IconName }) {
  return (
    <Icon
      name={name}
      size="var(--icon-xs)"
      className="zt:shrink-0 zt:text-muted-foreground"
    />
  );
}

/**
 * One line of quiet chrome, its segments divided by a separator each carries
 * after itself — the last suppressed, so no separator can begin a wrapped line.
 */
function Byline({ segments }: { segments: string[] }) {
  return (
    <span className="zt:min-w-0 zt:text-xs zt:text-muted-foreground zt:tabular-nums">
      {segments.map((segment, index) => (
        <span key={segment}>
          {segment}
          {index < segments.length - 1 && " · "}
        </span>
      ))}
    </span>
  );
}

function EmptyPane({
  message,
  action,
}: {
  message: string;
  action: { label: string; action: EmptyStateAction } | null;
}) {
  const actions = useContext(AnnotActionsContext);
  return (
    <div className="pane-empty zt:flex zt:flex-col zt:items-center zt:gap-4 zt:p-2">
      <div>{message}</div>
      {action && (
        <button
          onClick={() =>
            action.action === "enable-live-updates"
              ? actions.onEnableLiveUpdates()
              : actions.onPinItem()
          }
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/**
 * The search bar, revealed under the control row by the search toggle that
 * names it. Escape leaves it exactly as the toggle does — closed, with the
 * query cleared — and sends focus back to the button that opened it, so the
 * keyboard never lands nowhere. The press stops there: Obsidian's own Escape
 * would otherwise act on the pane behind it.
 *
 * The field takes `type="text"` for that: a `search` input keeps the browser's
 * own Escape-to-clear while it holds a query, and this surface would never see
 * the key.
 */
function SearchRow({
  id,
  searchButtonRef,
}: {
  id: string;
  searchButtonRef: RefObject<HTMLDivElement | null>;
}) {
  const filterQuery = useAnnotStore((s) => s.filterQuery);
  const setFilterQuery = useSetFilterQuery();
  const toggleSearchOpen = useToggleSearchOpen();
  // Preact renders `autoFocus` as the HTML attribute, which only acts at page
  // load; a field the toggle reveals is focused by hand once it is mounted. A
  // layout effect runs at commit, where a passive effect waits for a frame the
  // window may not paint.
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div id={id} className="zt:px-2 zt:pt-1">
      {/* The field's own name, in the words the toggle that reveals it carries:
          a placeholder is not a name, and no visible label has room in a row
          this dense. */}
      <label htmlFor={inputId} className="zt:sr-only">
        {m.annot_view_search_tooltip()}
      </label>
      <SearchInput
        id={inputId}
        ref={inputRef}
        value={filterQuery}
        onChange={setFilterQuery}
        type="text"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          toggleSearchOpen();
          searchButtonRef.current?.focus();
        }}
        placeholder={m.annot_view_search_placeholder()}
        clearLabel={m.annot_view_clear_search()}
      />
    </div>
  );
}

function AnnotList({ collapsed }: { collapsed: boolean }) {
  const annotations = useAnnotStore((s) => s.annotations);
  const clearFilters = useClearFilters();

  const filter = useAnnotFilter();
  const filtered = useMemo(
    () => (annotations ? filterAnnotations(annotations, filter) : []),
    [annotations, filter],
  );

  if (isFilterActive(filter) && filtered.length === 0) {
    return (
      <div className="pane-empty zt:flex zt:flex-col zt:items-center zt:gap-4 zt:p-2">
        <div>{m.annot_view_filter_no_match()}</div>
        <button onClick={clearFilters}>{m.annot_view_clear_filters()}</button>
      </div>
    );
  }

  return (
    // A grid, never `columns`: a masonry column reads down its own length, so
    // the page order the reader is scanning breaks the moment the pane widens.
    // The tracks answer to the scroll box's own width through the container
    // query on it, and `items-start` keeps each card the height of its own
    // content rather than its row's.
    <div className="annots-container zt:@container zt:min-h-0 zt:flex-1 zt:overflow-auto zt:px-3 zt:py-3">
      <div className="zt:grid zt:grid-cols-1 zt:items-start zt:gap-3 zt:@2xl:grid-cols-2 zt:@5xl:grid-cols-3">
        {filtered.map((annot) => (
          <Annotation key={annot.key} annot={annot} collapsed={collapsed} />
        ))}
      </div>
    </div>
  );
}
