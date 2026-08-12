// The rendered Cited By Sidebar list.
import { useEffect } from "react";
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
import { contextParts, occurrenceID, useCitedByStore } from "./store";
import type { CitedByPreview, OccurrenceContext } from "./store";

export function CitedBy() {
  const state = useCitedByStore((current) => current);
  const actions = useCitedByActions();
  const {
    indexedKey,
    snapshot,
    search,
    sectionCollapsed,
    previews,
    activePath,
  } = state;
  useEffect(() => {
    actions.loadPreviews(snapshot.groups);
    return () => actions.loadPreviews([]);
  }, [actions, snapshot]);
  if (!indexedKey) {
    return <EmptyState>{m.cited_by_open_literature_note()}</EmptyState>;
  }
  const { groups, coverage, resolution } = snapshot;
  const statuses = citedByStatuses(coverage, resolution);
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

  const visibleGroups = filterGroups(groups, { search, previews });
  const duplicateNames = duplicateNoteNames(groups);
  const occurrenceCount = groups.reduce(
    (total, group) => total + group.occurrences.length,
    0,
  );

  return (
    <div className="zt:min-h-full">
      {statuses.length > 0 && <StatusStrip statuses={statuses} />}
      <Toolbar paths={visibleGroups.map(({ path }) => path)} />
      <div className="zt:mx-3 zt:mt-1 zt:mb-2">
        <SearchInput
          className="zt:w-full"
          value={search}
          onChange={actions.setSearch}
          placeholder={m.cited_by_search_placeholder()}
          aria-label={m.cited_by_search_placeholder()}
          clearLabel={m.cited_by_clear_search()}
        />
      </div>
      <SectionHeader
        noteCount={groups.length}
        occurrenceCount={occurrenceCount}
      />
      {!sectionCollapsed && (
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
      )}
    </div>
  );
}

/** The native-looking nav header that carries the view-wide actions. */
function Toolbar({ paths }: { paths: readonly string[] }) {
  const actions = useCitedByActions();
  const collapsed = useCitedByStore((state) => state.collapsed);
  const allCollapsed =
    paths.length > 0 && paths.every((path) => collapsed.includes(path));

  return (
    <div className="nav-header">
      <div className="nav-buttons-container">
        <IconButton
          className="nav-action-button"
          icon="list"
          active={allCollapsed}
          data-cited-by-collapse-results
          {...tooltipAttrs(m.cited_by_collapse_results())}
          onClick={() =>
            allCollapsed ? actions.expandAll(paths) : actions.collapseAll(paths)
          }
        />
      </div>
    </div>
  );
}

function SectionHeader({
  noteCount,
  occurrenceCount,
}: {
  noteCount: number;
  occurrenceCount: number;
}) {
  const actions = useCitedByActions();
  const collapsed = useCitedByStore((state) => state.sectionCollapsed);

  return (
    <div
      className={cn(
        "zt:mx-3 zt:flex zt:cursor-clickable zt:items-center zt:rounded-(--nav-item-radius) zt:p-(--nav-item-padding) zt:ps-1 zt:text-(length:--nav-item-size) zt:leading-(--line-height-tight) zt:font-(--nav-heading-weight) zt:[corner-shape:var(--corner-shape)] zt:hover:bg-(--nav-item-background-hover)",
        collapsed
          ? "zt:text-(--nav-heading-color-collapsed) zt:hover:text-(--nav-heading-color-collapsed-hover)"
          : "zt:text-(--nav-heading-color) zt:hover:text-(--nav-heading-color-hover)",
      )}
      role="button"
      tabIndex={0}
      aria-expanded={!collapsed}
      data-cited-by-section-header
      onClick={actions.toggleSection}
      onKeyDown={activateWithKeyboard}
    >
      <span
        aria-hidden
        className="zt:flex zt:size-5 zt:shrink-0 zt:items-center zt:justify-center zt:text-(--nav-collapse-icon-color) zt:opacity-(--icon-opacity)"
        data-cited-by-section-chevron
      >
        <Icon
          name={collapsed ? "chevron-right" : "chevron-down"}
          size={12}
          strokeWidth={3}
        />
      </span>
      <span className="zt:min-w-0 zt:truncate">{m.cited_by_view_name()}</span>
      <span
        className="zt:ms-auto zt:shrink-0 zt:ps-1 zt:text-xs zt:whitespace-nowrap zt:text-faint zt:tabular-nums"
        data-cited-by-section-count
      >
        {m.cited_by_note_count({ count: noteCount })}
        {" · "}
        {m.cited_by_occurrence_count({ count: occurrenceCount })}
      </span>
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
  const excerpt =
    context.status === "ready" ? contextParts(source, context) : null;

  return (
    <li
      className={cn(
        "zt:relative zt:w-full zt:cursor-clickable zt:border-b-(length:--border-width) zt:border-(--background-modifier-border) zt:py-2 zt:ps-3 zt:pe-5 zt:whitespace-pre-wrap zt:[unicode-bidi:plaintext] zt:last:border-b-0",
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
          {excerpt.before}
          <mark className="zt:bg-(--text-highlight-bg) zt:text-foreground">
            {excerpt.token}
          </mark>
          {excerpt.after}
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

function activateWithKeyboard(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.currentTarget.click();
}

function filterGroups(
  groups: readonly CitedByGroup[],
  options: {
    search: string;
    previews: Readonly<Record<string, CitedByPreview>>;
  },
): readonly CitedByGroup[] {
  const query = options.search.trim().toLocaleLowerCase();
  if (!query) return groups;
  return groups.filter((group) => {
    if (group.path.toLocaleLowerCase().includes(query)) return true;
    const preview = options.previews[group.path];
    if (preview?.status !== "ready") return false;
    return group.occurrences.some((occurrence) => {
      const context = preview.contexts[occurrenceID(occurrence)];
      if (context?.status !== "ready") return false;
      const { before, token, after } = contextParts(preview.source, context);
      return `${before}${token}${after}`.toLocaleLowerCase().includes(query);
    });
  });
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

function noteName(path: string): string {
  const slash = path.lastIndexOf("/");
  const filename = path.slice(slash + 1);
  return filename.endsWith(".md") ? filename.slice(0, -3) : filename;
}
