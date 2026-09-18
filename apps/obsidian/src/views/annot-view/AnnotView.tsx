import { useContext, useMemo, useState } from "react";

import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import { SearchInput } from "@/components/obsidian/search-input";
import { SidebarToolbar } from "@/components/sidebar-toolbar";
import * as m from "@/lib/i18n/generated/messages";
import { activatable, tooltipAttrs } from "@/lib/utils";

import { AnnotActionsContext } from "./actions";
import { Annotation } from "./Annotation";
import { CapabilitySlot } from "./capability-slot";
import { uncertainCard } from "./card-conflict";
import { filterAnnotations, isFilterActive } from "./filter";
import { FilterBar } from "./FilterBar";
import {
  annotViewBody,
  attachmentLine,
  conditionLines,
  followModeIcon,
  followModeLabel,
  identityLabel,
  sourceTooltip,
} from "./presentation";
import type {
  AnnotViewBody,
  AttachmentLine as AttachmentSlot,
  EmptyStateAction,
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
function useAttachmentSlot(): AttachmentSlot {
  const attachments = useAnnotStore((s) => s.attachments);
  const selectedAttachmentKey = useAnnotStore((s) => s.selectedAttachmentKey);
  const attachmentLock = useAnnotStore((s) => s.attachmentLock);
  return useMemo(
    () =>
      attachmentLine({ attachments, selectedAttachmentKey, attachmentLock }),
    [attachments, selectedAttachmentKey, attachmentLock],
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

function useConditionLines(): string[] {
  const annotationSource = useAnnotStore((s) => s.annotationSource);
  const attachments = useAnnotStore((s) => s.attachments);
  const followMode = useAnnotStore((s) => s.followMode);
  const zoteroReaderClosed = useAnnotStore((s) => s.zoteroReaderClosed);
  return useMemo(
    () =>
      conditionLines({
        annotationSource,
        attachments,
        followMode,
        zoteroReaderClosed,
      }),
    [annotationSource, attachments, followMode, zoteroReaderClosed],
  );
}

export function AnnotView() {
  const searchOpen = useAnnotStore((s) => s.searchOpen);
  const body = useBody();
  const [collapsed, setCollapsed] = useState(true);

  const hasItem = body.kind === "list" || body.kind === "loading";

  return (
    <div className="zt:@container zt:flex zt:h-full zt:flex-col zt:overflow-hidden">
      <Toolbar
        hasItem={hasItem}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
      />
      <ItemIdentityLabel />
      <AttachmentLine />
      <ConditionLines />
      {hasItem && searchOpen && <SearchRow />}
      {hasItem && <FilterBar />}
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

interface ToolbarProps {
  hasItem: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/** `[mode ▾] [capability slot] [collapse/expand] [search]`. */
function Toolbar({ hasItem, collapsed, onToggleCollapsed }: ToolbarProps) {
  const searchOpen = useAnnotStore((s) => s.searchOpen);
  const toggleSearchOpen = useToggleSearchOpen();

  return (
    <SidebarToolbar className="zt:flex-col zt:gap-2 zt:@sm:flex-row zt:@sm:items-center">
      <SidebarToolbar.Actions className="zt:@sm:w-auto zt:@sm:shrink-0">
        <FollowModeMenu />
        <CapabilitySlot />
        {hasItem && (
          <>
            <IconButton
              icon={collapsed ? "chevrons-up-down" : "chevrons-down-up"}
              onClick={onToggleCollapsed}
              {...tooltipAttrs(
                collapsed
                  ? m.annot_view_expand_tooltip()
                  : m.annot_view_collapse_tooltip(),
              )}
            />
            <IconButton
              icon="search"
              active={searchOpen}
              onClick={toggleSearchOpen}
              {...tooltipAttrs(m.annot_view_search_tooltip())}
            />
          </>
        )}
      </SidebarToolbar.Actions>
    </SidebarToolbar>
  );
}

/**
 * The one button that changes the Follow Mode, beside the native pane menu and
 * the five commands. Nothing else writes the mode, and the entries it opens are
 * the ones the pane menu renders.
 *
 * @see apps/obsidian/docs/adr/0041-the-annotation-view-changes-its-follow-mode-only-on-a-user-gesture.md
 */
function FollowModeMenu() {
  const actions = useContext(AnnotActionsContext);
  const followMode = useAnnotStore((s) => s.followMode);

  return (
    <button
      className="clickable-icon zt:flex zt:items-center zt:gap-0.5"
      onClick={(evt) => actions.onFollowModeMenu(evt)}
      {...tooltipAttrs(followModeLabel(followMode))}
    >
      <Icon name={followModeIcon(followMode)} />
      <Icon name="chevron-down" size={12} />
    </button>
  );
}

/**
 * The Item's title and creators, shown only where nothing else on screen names
 * the Item — so never while the view follows the active tab.
 */
function ItemIdentityLabel() {
  const label = useAnnotStore(identityLabel);
  if (label === null) return null;

  return (
    <div className="zt:truncate zt:px-3 zt:pb-1 zt:text-xs zt:text-muted-foreground">
      {label}
    </div>
  );
}

/**
 * The Attachment on screen: a picker while the choice is the user's, and a
 * control disabled in place, with the reason, while a reader holds it.
 */
function AttachmentLine() {
  const actions = useContext(AnnotActionsContext);
  const line = useAttachmentSlot();

  if (line.kind === "hidden") return null;
  if (line.kind === "locked") {
    return (
      <div className="zt:px-3 zt:pb-1">
        <div
          className="clickable-icon zt:flex zt:w-full zt:items-center zt:text-xs"
          aria-disabled="true"
          {...tooltipAttrs(line.reason)}
        >
          <span className="zt:min-w-0 zt:flex-1 zt:truncate zt:text-left">
            {line.label}
          </span>
        </div>
      </div>
    );
  }

  const selected = line.options.find(
    (option) => option.key === line.selectedKey,
  );
  return (
    <div className="zt:px-3 zt:pb-1">
      <button
        className="clickable-icon zt:flex zt:w-full zt:items-center zt:gap-1 zt:text-xs"
        onClick={(evt) => actions.onAttachmentMenu(evt)}
        {...tooltipAttrs(m.annot_view_attachment_tooltip())}
      >
        <span className="zt:min-w-0 zt:flex-1 zt:truncate zt:text-left">
          {selected?.label}
        </span>
        <Icon name="chevron-down" size={12} />
      </button>
    </div>
  );
}

/**
 * What the list on screen cannot say for itself: its reader, and its source.
 *
 * The region is the source region as well, so it stands while a source is known
 * even where that source draws no line — under the Zotero Local API the words
 * "From Zotero" live in this tooltip alone.
 */
function ConditionLines() {
  const lines = useConditionLines();
  const annotationSource = useAnnotStore((s) => s.annotationSource);
  const tooltip = sourceTooltip({ annotationSource });
  if (lines.length === 0 && tooltip === null) return null;

  return (
    <div
      className="zt:flex zt:flex-col zt:gap-0.5 zt:px-3 zt:pb-1 zt:text-xs zt:text-muted-foreground"
      {...(tooltip === null ? {} : tooltipAttrs(tooltip))}
    >
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
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

function SearchRow() {
  const filterQuery = useAnnotStore((s) => s.filterQuery);
  const setFilterQuery = useSetFilterQuery();

  return (
    <div className="zt:px-3 zt:pb-1">
      <SearchInput
        value={filterQuery}
        onChange={setFilterQuery}
        autoFocus
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
    <div className="annots-container zt:@container zt:min-h-0 zt:flex-1 zt:overflow-auto zt:px-3 zt:pt-3 zt:pb-8 zt:text-xs">
      <div className="zt:columns-1 zt:gap-2 zt:@md:columns-2 zt:@md:gap-3 zt:@2xl:columns-3 zt:@4xl:columns-4">
        <UncertainCreateCards />
        {filtered.map((annot) => (
          <Annotation key={annot.key} annot={annot} collapsed={collapsed} />
        ))}
      </div>
    </div>
  );
}

/**
 * The creates on this Attachment whose answer was lost, each as a badged card
 * carrying what it asked Zotero for. They stand above the list because they
 * have no Sort Index to place them by: Zotero never confirmed them.
 *
 * Nothing retries on its own — both verbs are the user's — and the cards are
 * in memory only, so a reload drops them and the re-read shows whichever
 * Annotations did land.
 *
 * @see apps/obsidian/docs/adr/0039-an-uncertain-create-is-reconciled-by-stable-fields-and-retried-only-by-the-user.md
 */
function UncertainCreateCards() {
  const actions = useContext(AnnotActionsContext);
  const creates = useAnnotStore((s) => s.uncertainCreates);

  return creates.map((create) => {
    const card = uncertainCard(create.state, Temporal.Now.instant());
    return (
      <div
        key={create.writeToken}
        className="zt-annot-card zt:mb-2 zt:flex zt:break-inside-avoid zt:flex-col zt:gap-1 zt:overflow-hidden zt:rounded-sm zt:border zt:border-dashed zt:border-border zt:bg-background zt:px-2 zt:py-1.5 zt:@md:mb-3"
      >
        <div className="zt:flex zt:items-center zt:gap-1 zt:font-medium">
          <Icon name="alert-triangle" size={14} />
          {card.title}
        </div>
        <div className="zt:text-muted-foreground">{card.detail}</div>
        {create.draft.text !== "" && (
          <blockquote
            className="zt:border-l-2 zt:border-l-(--zt-annot-color) zt:pl-2 zt:leading-tight"
            style={
              { "--zt-annot-color": create.draft.color } as React.CSSProperties
            }
          >
            {create.draft.text}
          </blockquote>
        )}
        <div className="zt:flex zt:gap-2">
          {card.actions.map((action) => (
            <span
              key={action.kind}
              className="zt:cursor-link zt:rounded-sm zt:text-link zt:underline zt:underline-offset-2 zt:hover:text-link-hover zt:focus-visible:ring-2 zt:focus-visible:ring-border-focus zt:aria-disabled:cursor-not-allowed zt:aria-disabled:opacity-70"
              aria-disabled={action.disabled || undefined}
              {...activatable(
                () =>
                  action.kind === "retry"
                    ? actions.onRetryCreate(create.writeToken)
                    : actions.onDiscardCreate(create.writeToken),
                { disabled: action.disabled },
              )}
            >
              {action.label}
            </span>
          ))}
        </div>
      </div>
    );
  });
}
