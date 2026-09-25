import type { IconName } from "obsidian";
import {
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";

import { Icon } from "@/components/obsidian/icon";
import { SearchInput } from "@/components/obsidian/search-input";
import * as m from "@/lib/i18n/generated/messages";

import { AnnotActionsContext } from "./actions";
import { Annotation } from "./Annotation";
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
    <div className="zt:@container zt:flex zt:h-full zt:flex-col zt:overflow-hidden">
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
    </div>
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
  const actions = useContext(AnnotActionsContext);
  const annotations = useAnnotStore((s) => s.annotations);
  const clearFilters = useClearFilters();
  const gridRef = useRef<HTMLDivElement>(null);

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
    //
    // A click on the list's empty space, around or between the cards, closes
    // an open card editor or clears the Card Selection.
    <div
      className="annots-container zt:@container zt:min-h-0 zt:flex-1 zt:overflow-auto zt:px-3 zt:py-3"
      onClick={(e) => {
        if (e.target !== e.currentTarget && e.target !== gridRef.current)
          return;
        actions.onClearSelection();
      }}
    >
      <div
        ref={gridRef}
        className="zt:grid zt:grid-cols-1 zt:items-start zt:gap-2 zt:@2xl:grid-cols-2 zt:@5xl:grid-cols-3"
      >
        {filtered.map((annot) => (
          <Annotation key={annot.key} annot={annot} collapsed={collapsed} />
        ))}
      </div>
    </div>
  );
}
