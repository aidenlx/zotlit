// The rendered Cited By Sidebar list.
import { useEffect } from "react";

import { SearchInput } from "@/components/obsidian/search-input";
import * as m from "@/lib/i18n/generated/messages";
import { tooltipAttrs } from "@/lib/utils";
import type { CitedByGroup } from "@/services/citation-index/service";

import { useCitedByActions } from "./actions";
import { occurrenceID, useCitedByStore } from "./store";
import type { CitedByPreview } from "./store";

export function CitedBy() {
  const state = useCitedByStore((current) => current);
  const actions = useCitedByActions();
  const { indexedKey, snapshot, search, collapsed, previews, activePath } =
    state;
  if (!indexedKey) {
    return <p className="zt:p-3">{m.cited_by_open_literature_note()}</p>;
  }
  const { groups, coverage, resolution } = snapshot;
  if (
    groups.length === 0 &&
    coverage === "complete" &&
    resolution === "ready"
  ) {
    return <p className="zt:p-3">{m.cited_by_empty()}</p>;
  }

  const visibleGroups = filterGroups(groups, {
    search,
    collapsed,
    previews,
  });
  const duplicateNames = duplicateNoteNames(groups);
  const occurrenceCount = groups.reduce(
    (total, group) => total + group.occurrences.length,
    0,
  );

  return (
    <>
      <div className="zt:border-b zt:border-border zt:p-3">
        <SearchInput
          className="zt:w-full"
          value={search}
          onChange={actions.setSearch}
          placeholder={m.cited_by_search_placeholder()}
          aria-label={m.cited_by_search_placeholder()}
          clearLabel={m.cited_by_clear_search()}
        />
        <div className="zt:mt-2 zt:flex zt:items-center zt:justify-between zt:gap-2 zt:text-sm zt:text-muted-foreground">
          <span>
            {m.cited_by_note_count({ count: groups.length })}
            {" · "}
            {m.cited_by_occurrence_count({ count: occurrenceCount })}
          </span>
          <span className="zt:flex zt:gap-1">
            <button
              type="button"
              onClick={() =>
                actions.expandAll(visibleGroups.map(({ path }) => path))
              }
            >
              {m.cited_by_expand_all()}
            </button>
            <button
              type="button"
              onClick={() =>
                actions.collapseAll(visibleGroups.map(({ path }) => path))
              }
            >
              {m.cited_by_collapse_all()}
            </button>
          </span>
        </div>
      </div>
      {coverage === "indexing" && (
        <p className="zt:px-3 zt:py-2 zt:text-muted-foreground">
          {m.cited_by_indexing()}
        </p>
      )}
      {coverage === "degraded" && (
        <p className="zt:px-3 zt:py-2 zt:text-warning">
          {m.cited_by_coverage_degraded()}
        </p>
      )}
      {resolution === "resolving" && (
        <p className="zt:px-3 zt:py-2 zt:text-muted-foreground">
          {m.cited_by_resolving()}
        </p>
      )}
      {resolution === "degraded" && (
        <p className="zt:px-3 zt:py-2 zt:text-warning">
          {m.cited_by_resolution_degraded()}
        </p>
      )}
      <ul className="zt:m-0 zt:list-none zt:p-0">
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
    </>
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

  useEffect(() => {
    if (!collapsed) actions.requestPreview(group);
  }, [actions, collapsed, group, preview]);

  return (
    <li className="zt:border-b zt:border-border zt:px-3 zt:py-2">
      <div className="zt:flex zt:items-center zt:gap-1">
        <button
          type="button"
          aria-expanded={!collapsed}
          {...tooltipAttrs(
            collapsed
              ? m.cited_by_expand_source()
              : m.cited_by_collapse_source(),
          )}
          onClick={() => actions.toggleGroup(group.path)}
        >
          {collapsed ? "›" : "⌄"}
        </button>
        <button
          className="zt:min-w-0 zt:truncate zt:font-medium"
          type="button"
          data-source={group.path}
          onClick={(event) => actions.openSource(group.path, event)}
        >
          {label}
        </button>
      </div>
      {!collapsed && (
        <ul className="zt:mt-1 zt:list-none zt:p-0 zt:text-sm zt:text-muted-foreground">
          {preview?.status === "unavailable" && (
            <li>{m.cited_by_preview_unavailable()}</li>
          )}
          {preview?.status === "ready" &&
            group.occurrences.map((occurrence) => {
              const context = preview.contexts[occurrenceID(occurrence)];
              if (!context) return null;
              return (
                <li key={occurrenceID(occurrence)}>
                  <button
                    className="zt:block zt:w-full zt:truncate zt:text-left"
                    type="button"
                    data-occurrence={occurrenceID(occurrence)}
                    onClick={(event) =>
                      actions.openOccurrence(group, occurrence, event)
                    }
                  >
                    {context.status === "unavailable" ? (
                      m.cited_by_preview_unavailable()
                    ) : (
                      <>
                        {context.before}
                        <mark className="zt:bg-transparent zt:font-semibold zt:text-foreground">
                          {context.token}
                        </mark>
                        {context.after}
                      </>
                    )}
                  </button>
                </li>
              );
            })}
        </ul>
      )}
    </li>
  );
}

function filterGroups(
  groups: readonly CitedByGroup[],
  options: {
    search: string;
    collapsed: readonly string[];
    previews: Readonly<Record<string, CitedByPreview>>;
  },
): readonly CitedByGroup[] {
  const query = options.search.trim().toLocaleLowerCase();
  if (!query) return groups;
  return groups.filter((group) => {
    if (group.path.toLocaleLowerCase().includes(query)) return true;
    if (options.collapsed.includes(group.path)) return false;
    const preview = options.previews[group.path];
    if (preview?.status !== "ready") return false;
    return group.occurrences.some((occurrence) => {
      const context = preview.contexts[occurrenceID(occurrence)];
      return (
        context?.status === "ready" &&
        `${context.before}${context.token}${context.after}`
          .toLocaleLowerCase()
          .includes(query)
      );
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
