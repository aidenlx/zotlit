// The title block over the Library View's list: the selected node's icon, its
// Collection path and name, the papers shown with the unread count, Sort and
// "Save as query file", and the active facets and tags as chips that remove
// themselves. During a search its title is the match count.
//
// @see apps/obsidian/docs/adr/0072-the-library-tree-writes-filters.md
import type { IconName } from "obsidian";
import { Fragment, useSyncExternalStore } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { useStore } from "zustand";

import { useUniqueId } from "@zotlit/ui";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { tooltipAttrs } from "@/lib/utils";
import { SaveAsButton, SortButton } from "@/views/query-view/view";
import type { QueryView } from "@/views/query-view/view";

import type { LibraryNode, ReadingStateFacet } from "./document";
import { FACET_LABELS, nodeIcon, nodeLabel } from "./library-tree";
import type { LibraryTree } from "./library-tree";

/** What a search on screen puts in the heading. */
export interface HeaderSearch {
  /** Calls `listener` whenever what the search puts may have changed. */
  subscribe: (listener: () => void) => () => void;
  /**
   * The status a screen reader hears for the selection named `selection`;
   * `null` while no search is on screen or its count is unknown.
   */
  summary: (selection: string) => string | null;
  /** "N matches for “…”"; `null` while no search is on screen or its count is unknown. */
  title: () => string | null;
  /** Whether the search on screen reads every Library. */
  everywhere: () => boolean;
  /** The offer to search all libraries, beside the counts. */
  readonly action: ReactNode;
}

export interface LibraryHeadingHost {
  tree: LibraryTree;
  query: QueryView;
  search: HeaderSearch;
  /** Turn off every facet and let go of every selected tag, in one change. */
  clearFilters: () => void;
}

/** Draw the heading into `el`; unmount the root it returns as the view closes. */
export function renderHeading(el: HTMLElement, host: LibraryHeadingHost): Root {
  const root = createRoot(el);
  root.render(<LibraryHeading host={host} />);
  return root;
}

/** The names above a node's own: its Library and the Collections over it. */
function crumbsOf(
  libraries: Parameters<typeof nodeLabel>[0],
  node: LibraryNode,
): string[] {
  if (node.kind !== "collection") return [];
  return [
    nodeLabel(libraries, { kind: "library", library: node.library }),
    ...node.path.slice(0, -1),
  ];
}

/** The node's own name: its last Collection, its Library, or Recent. */
function nameOf(
  libraries: Parameters<typeof nodeLabel>[0],
  node: LibraryNode,
): string {
  return node.kind === "collection"
    ? node.path.at(-1)!
    : nodeLabel(libraries, node);
}

const SEPARATOR = (
  <span aria-hidden="true" className="zt:px-0.5">
    ›
  </span>
);

function LibraryHeading({ host }: { host: LibraryHeadingHost }) {
  const { tree, query, search } = host;
  const libraries = useStore(tree.store, (s) => s.libraries);
  const node = useStore(tree.store, (s) => s.node);
  const unread = useStore(tree.store, (s) => s.unread);
  const facets = useStore(tree.store, (s) => s.facets);
  const tags = useStore(tree.store, (s) => s.tags);
  const total = useStore(tree.store, () => tree.count);
  const results = useStore(query.state, (s) => s.results);
  const searchTitle = useSyncExternalStore(search.subscribe, search.title);
  const everywhere = useSyncExternalStore(search.subscribe, search.everywhere);
  const name = nameOf(libraries, node);
  const status = useSyncExternalStore(search.subscribe, () =>
    search.summary(node.kind === "collection" ? node.path.join(" / ") : name),
  );
  const toolsId = useUniqueId();
  const searching = searchTitle !== null;
  // During a search the path names where it searches, the node's own name
  // last.
  const crumbs = searching
    ? everywhere
      ? [m.library_view_heading_everywhere()]
      : [...crumbsOf(libraries, node), name]
    : crumbsOf(libraries, node);
  const narrowed = facets.length + tags.length > 0;
  const counts: string[] = [];
  if (results && !searching)
    counts.push(
      narrowed && total !== null
        ? m.library_view_heading_papers_of({ count: results.matched, total })
        : m.library_view_heading_papers({ count: results.matched }),
    );
  if (results?.truncated)
    counts.push(m.library_view_heading_first_shown({ count: results.count }));
  if (unread && !searching)
    counts.push(m.library_view_heading_unread({ count: unread }));
  return (
    // A size container: on a narrow list Sort and Save show their icons only.
    <div
      data-library-heading=""
      className="zt:@container zt:flex zt:flex-col zt:gap-(--size-4-2) zt:border-b-(length:--border-width) zt:border-(--table-border-color) zt:ps-(--zt-query-toolbar-inset-start) zt:pe-(--zt-query-toolbar-inset-end) zt:pt-(--size-4-3) zt:pb-(--size-4-3) zt:group-data-zotero-missing:hidden"
    >
      <div className="zt:flex zt:items-center zt:gap-(--size-4-3)">
        <span
          aria-hidden="true"
          data-library-heading-icon={searching ? "search" : nodeIcon(node)}
          className="zt:flex zt:size-9 zt:shrink-0 zt:items-center zt:justify-center zt:rounded-(--radius-m) zt:bg-(--interactive-accent)/12 zt:text-(--text-accent)"
        >
          {/* Half the tile, as a Help Link tile holds its icon. */}
          <Icon name={searching ? "search" : nodeIcon(node)} size="l" />
        </span>
        <div className="zt:flex zt:min-w-0 zt:flex-1 zt:flex-col">
          {crumbs.length > 0 && (
            <div
              data-library-heading-path=""
              className="zt:truncate zt:text-xs zt:text-muted-foreground"
            >
              {crumbs.map((crumb, index) => (
                <Fragment key={index}>
                  {crumb}
                  {SEPARATOR}
                </Fragment>
              ))}
            </div>
          )}
          {/* Obsidian styles a bare heading element; the title keeps its
              own type. */}
          <div
            role="heading"
            aria-level={2}
            data-library-header=""
            className="zt:m-0 zt:truncate zt:font-(family-name:--zt-font-display) zt:text-xl zt:leading-(--line-height-tight) zt:font-(--font-semibold) zt:text-(--text-normal)"
          >
            {searchTitle ?? name}
          </div>
          <div
            className="zt:flex zt:min-h-[1lh] zt:flex-wrap zt:items-center zt:gap-x-(--size-4-2) zt:text-(length:--font-ui-small) zt:text-muted-foreground"
            data-library-header-count=""
            data-query-count={results?.count}
            data-query-matched={results?.matched}
          >
            {counts.length > 0 && (
              <span className="zt:tabular-nums">{counts.join(" · ")}</span>
            )}
            {search.action}
          </div>
        </div>
        <div
          role="toolbar"
          aria-labelledby={toolsId}
          className="zt:flex zt:shrink-0 zt:items-center zt:gap-(--size-2-1) zt:self-start"
        >
          <span id={toolsId} className="zt:sr-only">
            {m.library_view_heading_tools()}
          </span>
          <SortButton view={query} />
          <SaveAsButton view={query} />
        </div>
      </div>
      {narrowed && (
        <FilterChips
          facets={facets}
          tags={tags}
          removeFacet={(facet) => tree.toggleFacet(facet)}
          removeTag={(tag) => tree.toggleTag(tag)}
          clear={host.clearFilters}
        />
      )}
      {/* A screen reader hears the search summary as it changes, and not a
          tree selection, which the tree announces itself. The status is on
          the page from the start, so the first count is heard too. */}
      <div role="status" className="zt:sr-only" data-library-search-status="">
        {status ?? ""}
      </div>
    </div>
  );
}

/** Act on Enter and Space, as a `role="button"` must. */
function onActivate(act: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    act();
  };
}

/**
 * Obsidian's unlayered `button` rules outrank the chip's utilities, so a chip
 * is drawn on an element of its own with `role="button"`.
 */
const CHIP =
  "zt:inline-flex zt:max-w-full zt:cursor-(--cursor) zt:items-center zt:gap-1 zt:rounded-(--radius-l) zt:border-(length:--border-width) zt:border-(--interactive-accent)/40 zt:bg-(--interactive-accent)/12 zt:py-(--size-2-1) zt:ps-(--size-4-2) zt:pe-(--size-2-2) zt:text-(length:--font-ui-smaller) zt:text-(--text-normal) zt:outline-hidden zt:hover:bg-(--interactive-accent)/22 zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)]";

/** An active filter, which removes itself on a click. */
function FilterChip({
  hook,
  label,
  icon,
  remove,
}: {
  hook: string;
  label: string;
  icon?: IconName;
  remove: () => void;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      data-library-filter={hook}
      className={CHIP}
      {...tooltipAttrs(m.library_view_heading_remove_filter({ name: label }))}
      onClick={remove}
      onKeyDown={onActivate(remove)}
    >
      {icon && (
        <Icon
          name={icon}
          size="xs"
          className="zt:shrink-0 zt:text-muted-foreground"
        />
      )}
      <span className="zt:truncate">{label}</span>
      <Icon
        name="x"
        size="xs"
        className="zt:shrink-0 zt:text-muted-foreground"
      />
    </span>
  );
}

function FilterChips({
  facets,
  tags,
  removeFacet,
  removeTag,
  clear,
}: {
  facets: readonly ReadingStateFacet[];
  tags: readonly string[];
  removeFacet: (facet: ReadingStateFacet) => void;
  removeTag: (tag: string) => void;
  clear: () => void;
}) {
  const id = useUniqueId();
  return (
    // Named by a hidden element: an `aria-label` would show a tooltip.
    <div
      role="group"
      aria-labelledby={id}
      data-library-filters=""
      className="zt:flex zt:flex-wrap zt:items-center zt:gap-(--size-2-3)"
    >
      <span id={id} className="zt:sr-only">
        {m.library_view_heading_filters()}
      </span>
      {facets.map((facet) => (
        <FilterChip
          key={facet}
          hook={`facet:${facet}`}
          label={FACET_LABELS[facet]()}
          remove={() => removeFacet(facet)}
        />
      ))}
      {tags.map((tag) => (
        <FilterChip
          key={tag}
          hook={`tag:${tag}`}
          label={tag}
          icon="tag"
          remove={() => removeTag(tag)}
        />
      ))}
      <span
        role="button"
        tabIndex={0}
        data-library-filter-clear=""
        className="zt:cursor-(--cursor) zt:rounded-(--radius-s) zt:px-(--size-2-2) zt:text-(length:--font-ui-smaller) zt:text-muted-foreground zt:outline-hidden zt:hover:text-(--text-normal) zt:hover:underline zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)]"
        onClick={clear}
        onKeyDown={onActivate(clear)}
      >
        {m.library_view_heading_clear_filters()}
      </span>
    </div>
  );
}
