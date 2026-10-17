// The Library Tree of the Library View: Recent, then the Libraries in the
// Library Scope with their nested Collections, each with its paper count, the
// Reading State facets under them, and the header of the list that names the
// selection with its unread count. The tree reads its Collections and counts
// again on every database change; a selection or a facet goes to the host,
// which makes it the query of the list.
//
// @see apps/obsidian/docs/adr/0071-the-library-tree-writes-filters.md
// @see apps/obsidian/docs/adr/0075-recent-is-a-library-tree-node-that-writes-a-sort.md
import { Component } from "obsidian";
import { Fragment } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

import { useUniqueId } from "@zotlit/ui";

import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import { Effect } from "@/lib/effect";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { cn, tooltipAttrs } from "@/lib/utils";
import type { QueryService } from "@/services/item-query/service";
import { libraryLabel } from "@/services/library-scope/label";
import { selectorKey } from "@/services/library-scope/scope";
import type { AvailableLibrary } from "@/services/library-scope/scope";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";
import type { LiteratureNotes } from "@/views/query-view/table-notes";

import { READING_STATE_FACETS } from "./document";
import type { LibraryNode, ReadingStateFacet } from "./document";
import { selectionConditions, vaultPass } from "./query-text";
import { collectionTree, findNode, sameLibrary } from "./tree";
import type { LibraryCounts, TreeCollection, TreeLibrary } from "./tree";

const logger = getLogger(["library-view", "tree"]);

export interface LibraryTreeDeps {
  reads: Pick<ZoteroReadsService, "on" | "acquireRead">;
  query: Pick<QueryService, "run">;
  libraryScope: Pick<LibraryScopeService, "on" | "current" | "libraries">;
  /** The Literature Notes the unread count leaves out. */
  literatureNotes: Pick<LiteratureNotes, "find" | "on">;
}

export interface LibraryTreeHost {
  /** The researcher picked `node`, or the tree no longer holds the one selected. */
  select: (node: LibraryNode) => void;
  /** The researcher turned a facet on or off: `facets` are those active now. */
  filter: (facets: readonly ReadingStateFacet[]) => void;
}

interface TreeState {
  /** The Libraries the tree shows; `null` before the first read settles. */
  readonly libraries: readonly TreeLibrary[] | null;
  readonly node: LibraryNode;
  /** Whether the tree shows every Library, not only those in the Library Scope. */
  readonly all: boolean;
  /** The nodes open to their children, by {@link nodeKey}. */
  readonly expanded: ReadonlySet<string>;
  /** Whether a narrow pane shows the tree over the list. */
  readonly open: boolean;
  /** The active Reading State facets, in {@link READING_STATE_FACETS} order. */
  readonly facets: readonly ReadingStateFacet[];
  /** The unread Items of the selected node; `null` while unknown. */
  readonly unread: number | null;
}

/** One identity for a node, whatever its names hold. */
export function nodeKey(node: LibraryNode): string {
  if (node.kind === "recent") return JSON.stringify(["recent"]);
  return JSON.stringify([
    selectorKey(node.library),
    ...(node.kind === "collection" ? node.path : []),
  ]);
}

/** The node and the Libraries above a Collection: what stays open to show it. */
function ancestors(node: LibraryNode): string[] {
  if (node.kind !== "collection") return [];
  return node.path.slice(0, -1).map((_, index) =>
    nodeKey({
      kind: "collection",
      library: node.library,
      path: node.path.slice(0, index + 1),
    }),
  );
}

export class LibraryTree extends Component {
  readonly store: StoreApi<TreeState>;
  readonly #deps: LibraryTreeDeps;
  readonly #host: LibraryTreeHost;
  #run: AbortController | null = null;
  #unreadRun: AbortController | null = null;
  #unreadSettled: Promise<void> = Promise.resolve();
  /** Settles once a read first lands, so a caller can wait for it before it starts. */
  readonly #first = Promise.withResolvers<void>();
  #settled: Promise<void> = this.#first.promise;
  #roots: Root[] = [];

  constructor(deps: LibraryTreeDeps, host: LibraryTreeHost) {
    super();
    this.#deps = deps;
    this.#host = host;
    this.store = createStore<TreeState>(() => ({
      libraries: null,
      node: { kind: "library", library: { type: "personal" } },
      all: false,
      expanded: new Set(),
      open: false,
      facets: [],
      unread: null,
    }));
  }

  /**
   * Settles once the tree shows the last read it started, and not before it
   * shows a first one. Never rejects.
   */
  get settled(): Promise<void> {
    return Promise.all([this.#settled, this.#unreadSettled]).then(
      () => this.#first.promise,
    );
  }

  override onload(): void {
    const { reads, libraryScope } = this.#deps;
    const refresh = () => this.refresh();
    // A database change, a database that cannot be read, and another Library
    // Scope each change what the tree holds.
    this.register(reads.on("changed", refresh));
    this.register(reads.on("degraded", refresh));
    this.register(reads.on("db-file-missing", refresh));
    this.register(libraryScope.on("changed", refresh));
    this.register(libraryScope.on("libraries-changed", refresh));
    // A Literature Note added or removed makes an Item read or unread.
    this.register(
      this.#deps.literatureNotes.on("changed", () => this.#countUnread()),
    );
  }

  override onunload(): void {
    this.#run?.abort();
    this.#run = null;
    this.#unreadRun?.abort();
    this.#unreadRun = null;
    this.#first.resolve();
    for (const root of this.#roots) root.unmount();
    this.#roots = [];
  }

  /** Show `node` as the selection, with the Collections above it open. */
  show(node: LibraryNode): void {
    const { expanded, node: shown } = this.store.getState();
    this.store.setState({
      node,
      open: false,
      expanded: new Set([...expanded, ...ancestors(node)]),
    });
    if (nodeKey(node) !== nodeKey(shown)) this.#countUnread();
  }

  /** Show `facets` as the active ones. */
  showFacets(facets: readonly ReadingStateFacet[]): void {
    this.store.setState({ facets });
  }

  /** The researcher turned `facet` on or off. */
  toggleFacet(facet: ReadingStateFacet): void {
    const { facets } = this.store.getState();
    this.#host.filter(
      READING_STATE_FACETS.filter((each) =>
        each === facet ? !facets.includes(each) : facets.includes(each),
      ),
    );
  }

  /** The researcher picked `node`. */
  select(node: LibraryNode): void {
    this.#host.select(node);
  }

  /** Show every Library, or only those in the Library Scope, and read them. */
  showAll(all: boolean): void {
    this.store.setState({ all });
    this.refresh();
  }

  toggle(key: string, open: boolean): void {
    const expanded = new Set(this.store.getState().expanded);
    if (open) expanded.add(key);
    else expanded.delete(key);
    this.store.setState({ expanded });
  }

  /** Show the tree over the list on a narrow pane, or hide it. */
  setOpen(open: boolean): void {
    this.store.setState({ open });
  }

  /** The count of the selected node; `null` while unknown. */
  get count(): number | null {
    const { libraries, node } = this.store.getState();
    return libraries ? (findNode(libraries, node)?.count ?? null) : null;
  }

  /** Whether some Library of the database lies outside the Library Scope. */
  get canWiden(): boolean {
    const scope = this.#deps.libraryScope.current;
    return (
      scope !== null &&
      this.#deps.libraryScope.libraries.length > scope.available.length
    );
  }

  /** The Libraries to read: those in scope, or all, and the selected one. */
  #shown(): readonly AvailableLibrary[] {
    const { all, node } = this.store.getState();
    const scope = this.#deps.libraryScope.current?.available ?? [];
    return this.#deps.libraryScope.libraries.filter(
      ({ selector }) =>
        all ||
        (node.kind !== "recent" && sameLibrary(selector, node.library)) ||
        scope.some((library) => sameLibrary(library.selector, selector)),
    );
  }

  /** Read the Collections and the counts of the shown Libraries again. */
  refresh(): void {
    this.#countUnread();
    this.#run?.abort();
    const controller = new AbortController();
    this.#run = controller;
    this.#settled = this.#read(this.#shown(), controller.signal).then(
      (libraries) => {
        if (controller.signal.aborted) return;
        this.#run = null;
        this.store.setState({ libraries: libraries.map(({ tree }) => tree) });
        this.#first.resolve();
        // A Collection renamed or removed in Zotero leaves its saved path
        // with nothing to list: the selection moves up to its Library.
        const { node } = this.store.getState();
        if (node.kind !== "collection") return;
        const read = libraries.find(({ tree }) =>
          sameLibrary(tree.library.selector, node.library),
        );
        if (read?.complete)
          if (!findNode([read.tree], node))
            this.#host.select({ kind: "library", library: node.library });
      },
    );
  }

  async #read(
    shown: readonly AvailableLibrary[],
    signal: AbortSignal,
  ): Promise<{ tree: TreeLibrary; complete: boolean }[]> {
    const paths = await this.#paths(shown);
    return Promise.all(
      shown.map(async (library, index) => {
        const counts = await this.#counts(library, signal);
        return {
          tree: {
            library,
            count: counts?.totalCount ?? null,
            collections: collectionTree(paths[index] ?? [], counts),
          },
          complete: paths[index] !== null,
        };
      }),
    );
  }

  /** Each Library's Collections as root-first names; `null` where the read failed. */
  async #paths(
    shown: readonly AvailableLibrary[],
  ): Promise<(readonly (readonly string[])[] | null)[]> {
    try {
      await using lease = await this.#deps.reads.acquireRead();
      const paths: (readonly (readonly string[])[] | null)[] = [];
      for (const { libraryID } of shown)
        paths.push(
          await Effect.runPromise(
            lease.reads.CollectionPaths({ libraryIDs: [libraryID] }),
          ),
        );
      return paths;
    } catch (error) {
      logger.warn("The Library Tree could not read the Collections", {
        error,
      });
      return shown.map(() => null);
    }
  }

  /**
   * One Library's Items grouped by the Collections they are filed in, each
   * Item by its Indexed Key alone. One query for each Library, since a path
   * names a Collection only inside its Library.
   */
  async #counts(
    library: AvailableLibrary,
    signal: AbortSignal,
  ): Promise<LibraryCounts | null> {
    try {
      const outcome = await this.#deps.query.run(
        {
          from: "items",
          fields: [],
          group: "collections[]",
          limit: null,
          libraries: { mode: "selected", libraries: [library.selector] },
        },
        signal,
      );
      if (outcome.kind === "result" && outcome.result.groups)
        return outcome.result;
      if (outcome.kind === "failed")
        logger.warn("The Library Tree could not count a Library", {
          code: outcome.diagnostic.code,
        });
      return null;
    } catch (error) {
      logger.warn("The Library Tree could not count a Library", { error });
      return null;
    }
  }

  /**
   * Count the unread Items of the selected node again: those the query finds
   * with no Annotation, less those with a Literature Note in the vault.
   */
  #countUnread(): void {
    this.#unreadRun?.abort();
    const controller = new AbortController();
    this.#unreadRun = controller;
    const { node } = this.store.getState();
    this.store.setState({ unread: null });
    // Recent names no paper count, so it names no unread count either.
    if (node.kind === "recent") {
      this.#unreadRun = null;
      this.#unreadSettled = Promise.resolve();
      return;
    }
    const { filters, vault } = selectionConditions(node, ["unread"]);
    const pass = vaultPass(vault, this.#deps.literatureNotes);
    this.#unreadSettled = this.#deps.query
      .run(
        {
          from: "items",
          fields: [],
          filter: filters.join(" && "),
          limit: null,
          libraries: { mode: "selected", libraries: [node.library] },
        },
        controller.signal,
      )
      .then(
        (outcome) => {
          if (controller.signal.aborted) return;
          this.#unreadRun = null;
          if (outcome.kind === "result" && outcome.result.rows)
            this.store.setState({
              unread: outcome.result.rows.filter(
                (row) => pass?.keeps(row) ?? true,
              ).length,
            });
          else if (outcome.kind === "failed")
            logger.warn("The Library Tree could not count the unread Items", {
              code: outcome.diagnostic.code,
            });
        },
        (error: unknown) => {
          logger.warn("The Library Tree could not count the unread Items", {
            error,
          });
        },
      );
  }

  /** Draw the tree into `el`. */
  render(el: HTMLElement): void {
    this.#mount(el, <TreePane tree={this} />);
  }

  /**
   * Draw the list header into `el`.
   * @param summary the header's text in place of its own `fallback`, as a
   * search on screen says it.
   */
  renderHeader(el: HTMLElement, summary?: HeaderSummary): void {
    this.#mount(el, <ListHeader tree={this} summary={summary} />);
  }

  #mount(el: HTMLElement, content: ReactNode): void {
    const root = createRoot(el);
    root.render(content);
    this.#roots.push(root);
  }
}

/** The name of a node: Recent, its Library's, or its Collection path. */
function nodeLabel(
  libraries: readonly TreeLibrary[] | null,
  node: LibraryNode,
): string {
  if (node.kind === "recent") return m.library_view_recent();
  if (node.kind === "collection") return node.path.join(" / ");
  const library = libraries?.find((entry) =>
    sameLibrary(entry.library.selector, node.library),
  );
  return library
    ? libraryLabel(library.library)
    : libraryLabel({ selector: node.library, libraryID: 0, name: null });
}

/** The header's text for the selection named `selection`, given its own `fallback`. */
export type HeaderSummary = (header: {
  selection: string;
  fallback: ReactNode;
}) => ReactNode;

function ListHeader({
  tree,
  summary,
}: {
  tree: LibraryTree;
  summary: HeaderSummary | undefined;
}) {
  const libraries = useStore(tree.store, (s) => s.libraries);
  const node = useStore(tree.store, (s) => s.node);
  const open = useStore(tree.store, (s) => s.open);
  const selection = nodeLabel(libraries, node);
  const count = libraries ? (findNode(libraries, node)?.count ?? null) : null;
  const unread = useStore(tree.store, (s) => s.unread);
  // The unread count is part of the header's own text, which a search
  // summary takes the place of.
  const text =
    count === null
      ? selection
      : unread === null
        ? m.library_view_header({ selection, count })
        : `${m.library_view_header({ selection, count })} ${m.library_view_header_unread({ count: unread })}`;
  return (
    <div className="zt:flex zt:min-w-0 zt:items-center zt:gap-(--size-2-2) zt:ps-(--zt-query-toolbar-inset-start) zt:pe-(--zt-query-toolbar-inset-end) zt:pt-(--size-4-2)">
      {/* Obsidian's own rule shows a clickable icon, so the narrow pane
          shows and hides a wrapper. */}
      <span className="zt:flex zt:@xl:hidden">
        <IconButton
          icon="library"
          data-library-tree-toggle=""
          pressed={open}
          {...tooltipAttrs(m.library_view_show_tree())}
          onClick={() => tree.setOpen(!open)}
        />
      </span>
      {/* Obsidian styles a bare heading element; the header keeps the UI
          type scale. */}
      <div
        role="heading"
        aria-level={2}
        data-library-header=""
        className="zt:m-0 zt:min-w-0 zt:truncate zt:text-(length:--font-ui-medium) zt:font-(--font-semibold)"
      >
        {summary ? summary({ selection, fallback: text }) : text}
      </div>
    </div>
  );
}

/** One row of the tree, as the keyboard and the screen see it. */
interface Row {
  readonly key: string;
  readonly node: LibraryNode;
  readonly label: string;
  readonly count: number | null;
  readonly level: number;
  /** `null` for a node without children. */
  readonly expanded: boolean | null;
}

/** Recent, at the top of the tree: it lists the whole Library Scope and counts nothing. */
const RECENT: LibraryNode = { kind: "recent" };

function rows(
  libraries: readonly TreeLibrary[],
  expanded: ReadonlySet<string>,
): Row[] {
  const out: Row[] = [];
  const collections = (
    library: AvailableLibrary,
    level: number,
    list: readonly TreeCollection[],
  ) => {
    for (const collection of list) {
      const node: LibraryNode = {
        kind: "collection",
        library: library.selector,
        path: collection.path,
      };
      const key = nodeKey(node);
      const open = expanded.has(key);
      out.push({
        key,
        node,
        label: collection.path.at(-1)!,
        count: collection.count,
        level,
        expanded: collection.children.length > 0 ? open : null,
      });
      if (open) collections(library, level + 1, collection.children);
    }
  };
  for (const { library, count, collections: list } of libraries) {
    const node: LibraryNode = { kind: "library", library: library.selector };
    const key = nodeKey(node);
    // A Library shows its Collections until the researcher closes it.
    const open = !expanded.has(`closed:${key}`);
    out.push({
      key,
      node,
      label: libraryLabel(library),
      count,
      level: 1,
      expanded: list.length > 0 ? open : null,
    });
    if (open) collections(library, 2, list);
  }
  return out;
}

function TreePane({ tree }: { tree: LibraryTree }) {
  const libraries = useStore(tree.store, (s) => s.libraries);
  const node = useStore(tree.store, (s) => s.node);
  const expanded = useStore(tree.store, (s) => s.expanded);
  const all = useStore(tree.store, (s) => s.all);
  const recent: Row = {
    key: nodeKey(RECENT),
    node: RECENT,
    label: m.library_view_recent(),
    count: null,
    level: 1,
    expanded: null,
  };
  // Recent shows before the first read lands: it needs no read of its own.
  const shown = [recent, ...(libraries ? rows(libraries, expanded) : [])];
  const selected = nodeKey(node);
  const headingId = useUniqueId();

  const open = (row: Row, value: boolean) =>
    row.level === 1
      ? tree.toggle(`closed:${row.key}`, !value)
      : tree.toggle(row.key, value);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    const row = shown[index]!;
    const focus = (to: number) => {
      const items =
        event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
          "[data-library-node]",
        );
      items?.[to]?.focus();
    };
    if (event.key === "Enter" || event.key === " ") tree.select(row.node);
    else if (event.key === "Escape" && tree.store.getState().open)
      tree.setOpen(false);
    else if (event.key === "ArrowDown") focus(index + 1);
    else if (event.key === "ArrowUp") focus(index - 1);
    else if (event.key === "ArrowRight" && row.expanded === false)
      open(row, true);
    else if (event.key === "ArrowLeft" && row.expanded === true)
      open(row, false);
    else return;
    event.preventDefault();
  };

  return (
    // Obsidian shows a tooltip for each `aria-label`, so the tree takes its
    // name from the heading on screen.
    <nav
      aria-labelledby={headingId}
      className="zt:flex zt:flex-col zt:gap-(--size-4-2) zt:p-(--size-4-2)"
    >
      <div
        role="tree"
        aria-labelledby={headingId}
        className="zt:flex zt:flex-col"
      >
        {shown.map((row, index) => (
          <Fragment key={row.key}>
            <div
              role="treeitem"
              data-library-node={row.key}
              aria-level={row.level}
              aria-selected={row.key === selected}
              aria-expanded={row.expanded ?? undefined}
              tabIndex={
                row.key === selected ||
                (index === 0 && !shown.some((r) => r.key === selected))
                  ? 0
                  : -1
              }
              style={{ "--zt-library-depth": row.level - 1 } as CSSProperties}
              className="zt:flex zt:min-w-0 zt:cursor-(--cursor) zt:items-center zt:gap-(--size-2-1) zt:rounded-(--radius-s) zt:py-(--size-2-2) zt:ps-[calc(var(--zt-library-depth)*var(--size-4-4)+var(--size-2-1))] zt:pe-(--size-4-2) zt:text-(length:--nav-item-size) zt:text-(--nav-item-color) zt:hover:not-aria-selected:bg-(--nav-item-background-hover) zt:aria-selected:bg-(--nav-item-background-selected) zt:aria-selected:text-(--nav-item-color-selected)"
              onClick={() => tree.select(row.node)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <span
                data-library-expand={row.expanded === null ? undefined : ""}
                data-collapsed={row.expanded === false ? "" : undefined}
                className={cn(
                  "zt:flex zt:size-(--size-4-4) zt:shrink-0 zt:items-center zt:justify-center zt:text-faint zt:transition-transform zt:data-collapsed:-rotate-90",
                  row.expanded === null && "zt:invisible",
                )}
                onClick={(event) => {
                  if (row.expanded === null) return;
                  event.stopPropagation();
                  open(row, !row.expanded);
                }}
              >
                <Icon name="right-triangle" size="var(--size-4-3)" />
              </span>
              <span
                data-library-label=""
                className="zt:min-w-0 zt:flex-1 zt:truncate"
              >
                {row.label}
              </span>
              {row.count !== null && (
                <span
                  data-library-count=""
                  className="zt:shrink-0 zt:text-(length:--font-ui-smaller) zt:text-faint zt:tabular-nums"
                >
                  {m.library_view_tree_count({ count: row.count })}
                </span>
              )}
            </div>
            {/* The heading over the Libraries names the tree, Recent above it
                included; assistive technology reads it as that name alone,
                not as an item of the tree. */}
            {index === 0 && (
              <div
                id={headingId}
                aria-hidden="true"
                className="zt:mt-(--size-4-2) zt:mb-(--size-2-1) zt:px-(--size-4-2) zt:text-(length:--font-ui-smaller) zt:font-(--font-semibold) zt:text-muted-foreground"
              >
                {m.library_view_tree_label()}
              </div>
            )}
          </Fragment>
        ))}
      </div>
      <Facets tree={tree} />
      {(all || tree.canWiden) && (
        <div
          role="button"
          tabIndex={0}
          data-library-all={all ? "on" : "off"}
          className="zt:cursor-(--cursor) zt:px-(--size-4-2) zt:text-(length:--font-ui-smaller) zt:text-muted-foreground zt:hover:text-(--text-normal)"
          onClick={() => tree.showAll(!all)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            tree.showAll(!all);
          }}
        >
          {all
            ? m.library_view_scope_libraries()
            : m.library_view_all_libraries()}
        </div>
      )}
    </nav>
  );
}

const FACET_LABELS: Record<ReadingStateFacet, () => string> = {
  unread: m.library_view_facet_unread,
  annotated: m.library_view_facet_annotated,
  "has-note": m.library_view_facet_has_note,
  pdf: m.library_view_facet_pdf,
};

/** The Reading State facets, each a toggle that narrows the list. */
function Facets({ tree }: { tree: LibraryTree }) {
  const facets = useStore(tree.store, (s) => s.facets);
  const headingId = useUniqueId();
  return (
    // Named by the heading on screen: an `aria-label` would show a tooltip.
    <div
      role="group"
      aria-labelledby={headingId}
      data-library-facets=""
      className="zt:flex zt:flex-col zt:gap-(--size-2-2)"
    >
      <div
        id={headingId}
        className="zt:px-(--size-4-2) zt:text-(length:--font-ui-smaller) zt:font-(--font-semibold) zt:text-muted-foreground"
      >
        {m.library_view_facets_label()}
      </div>
      <div className="zt:flex zt:flex-wrap zt:gap-(--size-2-2) zt:px-(--size-4-2)">
        {READING_STATE_FACETS.map((facet) => (
          // Obsidian's unlayered `button` rules outrank the chip's
          // utilities, so the chip is drawn on an element of its own, as the
          // "Show all libraries" toggle below is.
          <div
            key={facet}
            role="button"
            tabIndex={0}
            data-library-facet={facet}
            aria-pressed={facets.includes(facet)}
            className="zt:cursor-(--cursor) zt:rounded-(--radius-l) zt:border-(length:--border-width) zt:border-(--background-modifier-border) zt:px-(--size-4-2) zt:py-(--size-2-1) zt:text-(length:--font-ui-smaller) zt:text-muted-foreground zt:hover:bg-(--background-modifier-hover) zt:hover:text-(--text-normal) zt:aria-pressed:border-(--interactive-accent) zt:aria-pressed:bg-(--interactive-accent) zt:aria-pressed:text-(--text-on-accent) zt:aria-pressed:hover:bg-(--interactive-accent-hover) zt:aria-pressed:hover:text-(--text-on-accent)"
            onClick={() => tree.toggleFacet(facet)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              tree.toggleFacet(facet);
            }}
          >
            {FACET_LABELS[facet]()}
          </div>
        ))}
      </div>
    </div>
  );
}
