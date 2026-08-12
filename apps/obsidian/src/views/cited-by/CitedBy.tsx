// The rendered Cited By Sidebar list.
import { prepareSimpleSearch } from "obsidian";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import { SearchInput } from "@/components/obsidian/search-input";
import * as m from "@/lib/i18n/generated/messages";
import { cn, tooltipAttrs } from "@/lib/utils";
import type {
  CitationOccurrence,
  CitedByGroup,
  CitedBySnapshot,
} from "@/services/citation-index/service";

import { useCitedByActions } from "./actions";
import {
  contextParts,
  excerptKey,
  noteName,
  occurrenceID,
  useCitedByStore,
} from "./store";
import type {
  CitedByPreview,
  ExpandDirection,
  OccurrenceContext,
  SourceRange,
} from "./store";

/** Milliseconds between the last input change and the query it applies. */
export const SEARCH_DEBOUNCE = 300;

/** What an excerpt end that leaves out source text shows. */
const ELLIPSIS = "…";

export function CitedBy() {
  const state = useCitedByStore((current) => current);
  const actions = useCitedByActions();
  const {
    indexedKey,
    snapshot,
    search,
    searchVisible,
    moreContext,
    sort,
    previews,
    expansions,
    activePath,
  } = state;
  useEffect(() => {
    actions.loadPreviews(snapshot.groups);
    return () => actions.loadPreviews([]);
  }, [actions, snapshot]);
  const { groups, coverage, resolution } = snapshot;
  const statuses = citedByStatuses(coverage, resolution);
  const visibleGroups = actions.sortGroups(
    filterGroups(groups, { search, previews, moreContext, expansions }),
    sort,
  );
  const duplicateNames = duplicateNoteNames(groups);
  const occurrenceCount = visibleGroups.reduce(
    (total, group) => total + group.occurrences.length,
    0,
  );

  return (
    <div className="zt:min-h-full">
      {statuses.length > 0 && groups.length > 0 && (
        <StatusStrip statuses={statuses} />
      )}
      <Toolbar
        occurrenceCount={occurrenceCount}
        paths={visibleGroups.map(({ path }) => path)}
      />
      {searchVisible && <SearchFilter />}
      <Results
        activePath={activePath}
        coverage={coverage}
        duplicateNames={duplicateNames}
        groups={groups}
        indexedKey={indexedKey}
        resolution={resolution}
        statuses={statuses}
        visibleGroups={visibleGroups}
      />
    </div>
  );
}

/**
 * The results region: a Literature Note prompt, the final or in-progress
 * empty state, or the source list, in that priority order. Keys on the raw
 * `groups` emptiness (not `visibleGroups`) so a query that filters every
 * group out still shows the (empty) results list rather than an empty state.
 */
function Results({
  activePath,
  coverage,
  duplicateNames,
  groups,
  indexedKey,
  resolution,
  statuses,
  visibleGroups,
}: {
  activePath: string | null;
  coverage: CitedBySnapshot["coverage"];
  duplicateNames: ReadonlySet<string>;
  groups: readonly CitedByGroup[];
  indexedKey: string | null;
  resolution: CitedBySnapshot["resolution"];
  statuses: readonly CitedByStatus[];
  visibleGroups: readonly CitedByGroup[];
}) {
  if (!indexedKey) {
    return <EmptyState>{m.cited_by_open_literature_note()}</EmptyState>;
  }
  if (
    groups.length === 0 &&
    coverage === "complete" &&
    resolution === "ready"
  ) {
    return <EmptyState>{m.cited_by_empty()}</EmptyState>;
  }
  if (groups.length === 0) {
    return (
      <EmptyState>
        {statuses.map(({ key, message }) => (
          <div key={key}>{message}</div>
        ))}
      </EmptyState>
    );
  }

  return (
    <ul
      className="zt:m-0 zt:list-none zt:px-3 zt:pt-1 zt:pb-4"
      data-cited-by-results
    >
      {visibleGroups.map((group) => (
        <CitedBySource
          group={group}
          key={group.path}
          label={sourceLabel(group.path, {
            activePath,
            duplicateNames,
          })}
        />
      ))}
    </ul>
  );
}

/**
 * The native-looking nav header that carries the view-wide actions and the
 * counts. Both counts describe the groups it receives, so a query narrows them
 * with the list below.
 */
function Toolbar({
  occurrenceCount,
  paths,
}: {
  occurrenceCount: number;
  paths: readonly string[];
}) {
  const actions = useCitedByActions();
  const collapsed = useCitedByStore((state) => state.collapsed);
  const searchVisible = useCitedByStore((state) => state.searchVisible);
  const moreContext = useCitedByStore((state) => state.moreContext);
  const allCollapsed =
    paths.length > 0 && paths.every((path) => collapsed.includes(path));

  return (
    // Below the width where the icon row and both counts fit together, the
    // counts take a row of their own at the end of it, under an icon row that
    // centers itself the way the native header centers actions that stand
    // alone.
    <div className="zt:@container zt:flex zt:flex-wrap zt:items-center zt:p-2">
      <div className="zt:flex zt:w-full zt:flex-wrap zt:justify-center zt:gap-0.5 zt:@3xs:w-auto zt:@3xs:flex-1 zt:@3xs:justify-start">
        <IconButton
          icon="list"
          active={allCollapsed}
          data-cited-by-collapse-results
          {...tooltipAttrs(m.cited_by_collapse_results())}
          onClick={() =>
            allCollapsed ? actions.expandAll(paths) : actions.collapseAll(paths)
          }
        />
        <IconButton
          icon="move-vertical"
          active={moreContext}
          data-cited-by-show-more-context
          {...tooltipAttrs(m.cited_by_show_more_context())}
          onClick={actions.toggleMoreContext}
        />
        <IconButton
          icon="sort-asc"
          data-cited-by-sort
          {...tooltipAttrs(m.cited_by_change_sort_order())}
          onClick={actions.showSortMenu}
        />
        <IconButton
          icon="search"
          active={searchVisible}
          data-cited-by-show-search
          {...tooltipAttrs(m.cited_by_show_search_filter())}
          onClick={actions.toggleSearch}
        />
      </div>
      <span
        className="zt:w-full zt:min-w-0 zt:truncate zt:pt-1 zt:text-end zt:text-xs zt:text-faint zt:tabular-nums zt:@3xs:w-auto zt:@3xs:ps-1 zt:@3xs:pt-0"
        data-cited-by-stats
      >
        {m.cited_by_note_count({ count: paths.length })}
        {" · "}
        {m.cited_by_occurrence_count({ count: occurrenceCount })}
      </span>
    </div>
  );
}

/** The hidden-by-default query field: focused on open, debounced on input. */
function SearchFilter() {
  const actions = useCitedByActions();
  const search = useCitedByStore((state) => state.search);
  const [text, setText] = useState(search);
  const field = useRef<HTMLDivElement>(null);

  useEffect(() => {
    field.current?.querySelector("input")?.focus();
  }, []);
  useEffect(() => {
    if (text === search) return;
    const timer = setTimeout(() => actions.setSearch(text), SEARCH_DEBOUNCE);
    return () => clearTimeout(timer);
  }, [actions, search, text]);

  return (
    <div className="zt:mx-3 zt:mt-1 zt:mb-2" data-cited-by-search ref={field}>
      <SearchInput
        className="zt:w-full"
        value={text}
        onChange={setText}
        placeholder={m.cited_by_search_placeholder()}
        aria-label={m.cited_by_search_placeholder()}
        clearLabel={m.cited_by_clear_search()}
      />
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      className="zt:mx-auto zt:my-2 zt:px-4 zt:py-6 zt:text-center zt:text-sm zt:text-faint"
      data-cited-by-empty
    >
      {children}
    </div>
  );
}

interface CitedByStatus {
  key: string;
  message: string;
  warning: boolean;
}

function citedByStatuses(
  coverage: CitedBySnapshot["coverage"],
  resolution: CitedBySnapshot["resolution"],
): readonly CitedByStatus[] {
  const statuses: CitedByStatus[] = [];
  if (coverage === "indexing") {
    statuses.push({
      key: "indexing",
      message: m.cited_by_indexing(),
      warning: false,
    });
  } else if (coverage === "degraded") {
    statuses.push({
      key: "coverage-degraded",
      message: m.cited_by_coverage_degraded(),
      warning: true,
    });
  }
  if (resolution === "resolving") {
    statuses.push({
      key: "resolving",
      message: m.cited_by_resolving(),
      warning: false,
    });
  } else if (resolution === "degraded") {
    statuses.push({
      key: "resolution-degraded",
      message: m.cited_by_resolution_degraded(),
      warning: true,
    });
  }
  return statuses;
}

function StatusStrip({ statuses }: { statuses: readonly CitedByStatus[] }) {
  return (
    <div
      className="zt:sticky zt:top-0 zt:z-1 zt:flex zt:flex-col zt:gap-1 zt:bg-muted zt:p-3 zt:ps-6 zt:text-sm zt:leading-snug"
      role="status"
    >
      {statuses.map(({ key, message, warning }) => (
        <div className={cn(warning && "zt:text-(--text-warning)")} key={key}>
          {message}
        </div>
      ))}
    </div>
  );
}

function CitedBySource({
  group,
  label,
}: {
  group: CitedByGroup;
  label: string;
}) {
  const actions = useCitedByActions();
  const collapsed = useCitedByStore((state) =>
    state.collapsed.includes(group.path),
  );
  const preview = useCitedByStore((state) => state.previews[group.path]);

  return (
    <li className="zt:break-words" data-cited-by-result>
      <div
        className={cn(
          "zt:group zt:relative zt:mb-(--nav-item-margin-bottom) zt:flex zt:items-center zt:rounded-(--nav-item-radius) zt:p-(--nav-item-padding) zt:pe-0 zt:text-(length:--nav-item-size) zt:leading-(--line-height-tight) zt:font-(--nav-item-weight) zt:[corner-shape:var(--corner-shape)] zt:focus-within:bg-(--nav-item-background-hover) zt:hover:bg-(--nav-item-background-hover) zt:hover:font-(--nav-item-weight-hover) zt:hover:text-(--nav-item-color-hover)",
          collapsed
            ? "zt:text-(--nav-item-color)"
            : "zt:text-(--nav-item-color-active)",
        )}
        data-cited-by-source-header
      >
        <div
          className="zt:absolute zt:inset-0 zt:cursor-clickable zt:rounded-(--nav-item-radius) zt:[corner-shape:var(--corner-shape)]"
          role="button"
          tabIndex={0}
          aria-expanded={!collapsed}
          data-cited-by-source-toggle
          {...tooltipAttrs(
            collapsed
              ? m.cited_by_expand_source()
              : m.cited_by_collapse_source(),
          )}
          onClick={() => actions.toggleGroup(group.path)}
          onKeyDown={activateWithKeyboard}
        />
        <div
          aria-hidden
          className="zt:pointer-events-none zt:absolute zt:start-0.5 zt:top-1/2 zt:z-1 zt:flex zt:size-5 zt:-translate-y-1/2 zt:items-center zt:justify-center zt:text-(--nav-collapse-icon-color) zt:opacity-(--icon-opacity)"
          data-cited-by-source-chevron
        >
          <Icon
            name={collapsed ? "chevron-right" : "chevron-down"}
            size={12}
            strokeWidth={3}
          />
        </div>
        <div
          className="zt:pointer-events-none zt:z-1 zt:min-w-0 zt:flex-1 zt:overflow-hidden zt:whitespace-pre-wrap zt:[unicode-bidi:plaintext]"
          data-cited-by-source-label
        >
          {label}
        </div>
        <span
          className="zt:pointer-events-none zt:z-1 zt:ms-auto zt:flex zt:shrink-0 zt:items-center zt:ps-1"
          data-cited-by-source-count
        >
          <span className="zt:rounded-sm zt:text-xs zt:leading-none zt:text-faint zt:group-hover:text-(--text-muted)">
            {group.occurrences.length}
          </span>
        </span>
        <div
          className="zt:z-1 zt:ms-0.5 zt:flex zt:size-5 zt:shrink-0 zt:cursor-clickable zt:items-center zt:justify-center zt:rounded-sm zt:text-(--text-faint) zt:hover:bg-(--background-modifier-hover) zt:hover:text-(--text-normal) zt:focus-visible:bg-(--background-modifier-hover) zt:focus-visible:text-(--text-normal)"
          data-source={group.path}
          role="button"
          tabIndex={0}
          {...tooltipAttrs(m.cited_by_open_source())}
          onClick={(event) => actions.openSource(group.path, event)}
          onKeyDown={activateWithKeyboard}
        >
          <Icon name="arrow-up-right" size={14} />
        </div>
      </div>
      {!collapsed && (
        <ul
          className="zt:mt-1 zt:mb-2 zt:overflow-hidden zt:rounded-(--radius-s) zt:bg-(--search-result-background) zt:text-xs zt:leading-(--line-height-tight) zt:text-(--text-muted) zt:shadow-[0_0_0_var(--border-width)_var(--background-modifier-border)] zt:empty:hidden"
          data-cited-by-cards
        >
          {preview?.status === "unavailable" && (
            <li className="zt:flex zt:gap-2 zt:px-3 zt:py-2 zt:text-(--text-error)">
              <span aria-hidden>⚠</span>
              <span>{m.cited_by_preview_unavailable()}</span>
            </li>
          )}
          {preview?.status === "ready" &&
            group.occurrences.map((occurrence) => {
              const context = preview.contexts[occurrenceID(occurrence)];
              if (!context) return null;
              return (
                <OccurrenceCard
                  context={context}
                  group={group}
                  key={occurrenceID(occurrence)}
                  occurrence={occurrence}
                  source={preview.source}
                />
              );
            })}
        </ul>
      )}
    </li>
  );
}

/**
 * One Citation Occurrence as a search-result card: the Citation Context with
 * the citation highlighted inside it, selected on hover and on keyboard focus.
 * A chevron on each clipped end reveals more of the citing note.
 */
function OccurrenceCard({
  context,
  group,
  occurrence,
  source,
}: {
  context: OccurrenceContext;
  group: CitedByGroup;
  occurrence: CitationOccurrence;
  source: string;
}) {
  const actions = useCitedByActions();
  const moreContext = useCitedByStore((state) => state.moreContext);
  const expansion = useCitedByStore(
    (state) => state.expansions[excerptKey(group.path, occurrence)],
  );
  const excerpt =
    context.status === "ready"
      ? contextParts(source, context, { moreContext, expansion })
      : null;

  return (
    <li
      className={cn(
        "zt:group zt:relative zt:w-full zt:cursor-clickable zt:border-b-(length:--border-width) zt:border-(--background-modifier-border) zt:py-2 zt:ps-3 zt:pe-5 zt:whitespace-pre-wrap zt:[unicode-bidi:plaintext] zt:last:border-b-0",
        "zt:hover:bg-(--text-selection) zt:hover:text-(--text-normal)",
        "zt:focus-visible:rounded-sm zt:focus-visible:bg-(--text-selection) zt:focus-visible:text-(--text-normal) zt:focus-visible:shadow-[inset_0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)]",
        context.status === "unavailable" &&
          "zt:text-(--text-error) zt:hover:text-(--text-error) zt:focus-visible:text-(--text-error)",
      )}
      role="button"
      tabIndex={0}
      data-occurrence={occurrenceID(occurrence)}
      onClick={(event) => actions.openOccurrence(group, occurrence, event)}
      onKeyDown={activateWithKeyboard}
    >
      {excerpt ? (
        <>
          {excerpt.canExpandBefore && (
            <ExpandContext
              direction="before"
              group={group}
              occurrence={occurrence}
            />
          )}
          {excerpt.ellipsisBefore && ELLIPSIS}
          {excerpt.before}
          <mark className="zt:bg-(--text-highlight-bg) zt:text-foreground">
            {excerpt.token}
          </mark>
          {excerpt.after}
          {excerpt.ellipsisAfter && ELLIPSIS}
          {excerpt.canExpandAfter && (
            <ExpandContext
              direction="after"
              group={group}
              occurrence={occurrence}
            />
          )}
        </>
      ) : (
        <>
          <span aria-hidden className="zt:mr-2">
            ⚠
          </span>
          {m.cited_by_preview_unavailable()}
        </>
      )}
    </li>
  );
}

/**
 * The chevron that reveals the logical chunk next to one excerpt. It rides the
 * end edge of its card, out of view until the pointer or keyboard focus
 * reaches the card, the way Obsidian's own search results present it.
 */
function ExpandContext({
  direction,
  group,
  occurrence,
}: {
  direction: ExpandDirection;
  group: CitedByGroup;
  occurrence: CitationOccurrence;
}) {
  const actions = useCitedByActions();
  const before = direction === "before";

  return (
    <span
      className={cn(
        "zt:absolute zt:end-0.5 zt:z-1 zt:flex zt:cursor-clickable zt:rounded-sm zt:px-[3px] zt:py-px zt:text-faint zt:opacity-0 zt:hover:bg-(--background-modifier-hover) zt:hover:text-(--text-normal)",
        // Out of reach as well as out of view, so a card click stays a card
        // click until the chevron shows itself.
        "zt:pointer-events-none zt:group-focus-within:pointer-events-auto zt:group-focus-within:opacity-100 zt:group-hover:pointer-events-auto zt:group-hover:opacity-100",
        before ? "zt:top-0.5" : "zt:bottom-0.5",
      )}
      role="button"
      tabIndex={0}
      data-cited-by-expand={direction}
      {...tooltipAttrs(
        before
          ? m.cited_by_show_context_above()
          : m.cited_by_show_context_below(),
        { placement: before ? "top" : "bottom" },
      )}
      onClick={(event) => {
        event.stopPropagation();
        actions.expandExcerpt({ group, occurrence, direction });
      }}
      onKeyDown={activateNestedWithKeyboard}
    >
      <Icon name={before ? "chevron-up" : "chevron-down"} size={12} />
    </span>
  );
}

function activateWithKeyboard(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.currentTarget.click();
}

/** Activation that stays with the control, leaving its card's own alone. */
function activateNestedWithKeyboard(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.stopPropagation();
  activateWithKeyboard(event);
}

/**
 * The groups one query keeps: a matching note path keeps the group whole,
 * otherwise the group keeps only occurrences whose Citation Context matches.
 * Every group is tested, collapsed ones included, because their text is
 * already loaded; filtering never reads a file itself.
 */
function filterGroups(
  groups: readonly CitedByGroup[],
  options: {
    search: string;
    previews: Readonly<Record<string, CitedByPreview>>;
    moreContext: boolean;
    expansions: Readonly<Record<string, SourceRange>>;
  },
): readonly CitedByGroup[] {
  const query = options.search.trim();
  if (!query) return groups;
  const matches = prepareSimpleSearch(query);
  const kept: CitedByGroup[] = [];
  for (const group of groups) {
    if (matches(group.path)) {
      kept.push(group);
      continue;
    }
    const preview = options.previews[group.path];
    if (preview?.status !== "ready") continue;
    const occurrences = group.occurrences.filter((occurrence) => {
      const context = preview.contexts[occurrenceID(occurrence)];
      if (context?.status !== "ready") return false;
      const { before, token, after } = contextParts(preview.source, context, {
        moreContext: options.moreContext,
        expansion: options.expansions[excerptKey(group.path, occurrence)],
      });
      return matches(`${before}${token}${after}`) !== null;
    });
    if (occurrences.length > 0) kept.push({ ...group, occurrences });
  }
  return kept;
}

function duplicateNoteNames(groups: readonly CitedByGroup[]): Set<string> {
  const counts = new Map<string, number>();
  for (const { path } of groups) {
    const name = noteName(path);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return new Set(
    [...counts].filter(([, count]) => count > 1).map(([name]) => name),
  );
}

function sourceLabel(
  path: string,
  options: { activePath: string | null; duplicateNames: ReadonlySet<string> },
): string {
  if (path === options.activePath) return m.cited_by_this_note();
  const name = noteName(path);
  if (!options.duplicateNames.has(name)) return name;
  const slash = path.lastIndexOf("/");
  const folder = slash === -1 ? "/" : path.slice(0, slash);
  return `${name} — ${folder}`;
}
