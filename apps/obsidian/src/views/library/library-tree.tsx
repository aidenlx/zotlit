// The Library Tree of the Library View: Recent, then the Libraries in the
// Library Scope with their nested Collections, each with its paper count, the
// Reading State facets under them, and the Tag Selector at its foot. It
// counts the unread Items of the selection for the list heading. The tree reads its Collections, counts and tags again on
// every database change; a selection, a facet or a tag goes to the host,
// which makes it the query of the list.
//
// @see apps/obsidian/docs/adr/0072-the-library-tree-writes-filters.md
// @see apps/obsidian/docs/adr/0076-recent-is-a-library-tree-node-that-writes-a-sort.md
// @see apps/obsidian/docs/adr/0078-the-tag-selector-writes-tag-filters.md
import { Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Component } from "obsidian";
import type { IconName } from "obsidian";
import { Fragment } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { useUniqueId } from "@zotlit/ui";

import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";
import { cn, tooltipAttrs } from "@/lib/utils";
import { ViewRegistryProvider } from "@/lib/view-atoms";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import { libraryLabel } from "@/services/library-scope/label";
import type { AvailableLibrary } from "@/services/library-scope/scope";

import { FILTER_CHIP_CLASS } from "./chip";
import { nodeKey, READING_STATE_FACETS, sortTags } from "./document";
import type { LibraryNode, ReadingStateFacet } from "./document";
import { waitForRead } from "./model";
import { TagSelector } from "./tag-selector";
import { TextAction } from "./text-action";
import { CLOSED_PREFIX, findNode, knowsNode, sameLibrary } from "./tree";
import type { TreeCollection, TreeLibrary } from "./tree";
import {
  makeTreeModel,
  patchTree,
  refreshTree,
  TreeModelProvider,
  useTreeState,
} from "./tree-model";
import type { TreeSession } from "./tree-model";

export interface LibraryTreeDeps {
  registry: ViewRegistryHandle;
}

export interface LibraryTreeHost {
  /** The researcher picked `node`, or the tree no longer holds the one selected. */
  select: (node: LibraryNode) => void;
  /** The researcher turned a facet on or off: `facets` are those active now. */
  filter: (facets: readonly ReadingStateFacet[]) => void;
  /** The researcher selected or let go of a tag: `tags` are those selected now. */
  tag: (tags: readonly string[]) => void;
  /** The researcher opened or closed a node: `expanded` are the nodes open now. */
  expand: (expanded: readonly string[]) => void;
  /** A read of the tree landed: the open nodes it does not `know` are gone. */
  prune: (know: (key: string) => boolean) => void;
  /** The researcher collapsed the tree beside a wide list, or showed it. */
  collapse: (collapsed: boolean) => void;
}

export class LibraryTree extends Component {
  readonly model;
  readonly registry;
  readonly #host;
  #release: (() => void) | null;
  readonly #waiting = new Set<() => void>();
  #roots: Root[] = [];

  constructor(deps: LibraryTreeDeps, host: LibraryTreeHost) {
    super();
    this.#host = host;
    this.registry = deps.registry;
    this.model = makeTreeModel();
    this.#release = this.registry.mount(this.model.session);
  }

  get state() {
    return this.registry.get(this.model.state);
  }
  #update(transition: (state: TreeSession) => TreeSession): void {
    this.registry.update(this.model.session, transition);
  }
  subscribe(listener: (state: LibraryTree["state"]) => void): () => void {
    return this.registry.subscribe(this.model.state, listener);
  }

  /** The name of the selected node, as a file saved from it is first called. */
  get name(): string {
    const { libraries, node } = this.state;
    return node.kind === "collection"
      ? node.path.at(-1)!
      : nodeLabel(libraries, node);
  }

  /**
   * Settles once the tree shows the last read it started, and not before it
   * shows a first one. Never rejects.
   */
  get settled(): Promise<void> {
    return Promise.all([
      waitForRead(this.registry, this.model.loaded, this.#waiting),
      waitForRead(this.registry, this.model.unread, this.#waiting),
      waitForRead(this.registry, this.model.tagList, this.#waiting),
    ]).then(() => {});
  }

  #patch(patch: Partial<TreeSession>): void {
    this.#update(patchTree(patch));
  }

  override onload(): void {
    this.#release ??= this.registry.mount(this.model.session);
    this.register(this.registry.mount(this.model.state));
    this.register(
      this.registry.subscribe(this.model.canWiden, (canWiden) => {
        if (!canWiden && this.registry.get(this.model.session).all)
          this.#patch({ all: false });
      }),
    );
    this.register(
      this.registry.subscribe(this.model.loaded, (result) => {
        if (result.waiting || AsyncResult.isFailure(result)) return;
        const libraries = Option.getOrNull(AsyncResult.value(result));
        if (!libraries) return;
        this.#host.prune(knowsNode(libraries));
        const { node } = this.state;
        if (node.kind !== "collection") return;
        const read = libraries.find(({ tree }) =>
          sameLibrary(tree.library.selector, node.library),
        );
        if (read?.complete && !findNode([read.tree], node))
          this.#host.select({ kind: "library", library: node.library });
      }),
    );
    this.register(() => {
      this.#release?.();
      this.#release = null;
    });
  }

  override onunload(): void {
    for (const finish of this.#waiting) finish();
    for (const root of this.#roots) root.unmount();
    this.#roots = [];
  }

  /** Show `node` as the selection. */
  show(node: LibraryNode): void {
    this.#patch({ node, open: false });
  }

  /**
   * Show whether the list shows the selected node: a search of all
   * libraries reads past it.
   */
  showListed(listed: boolean): void {
    this.#patch({ listed });
  }

  /** Show `tags` as the selected ones, and list the tags they leave. */
  showTags(tags: readonly string[]): void {
    this.#patch({ tags });
  }

  /** The researcher selected or let go of the tag `name`. */
  toggleTag(name: string): void {
    const { tags } = this.state;
    this.#host.tag(
      tags.includes(name)
        ? tags.filter((tag) => tag !== name)
        : sortTags([...tags, name]),
    );
  }

  /** The researcher let go of every selected tag. */
  clearTags(): void {
    this.#host.tag([]);
  }

  /** Narrow the tag names shown to those that hold `text`. */
  setTagFilter(text: string): void {
    this.#patch({ tagFilter: text });
  }

  /** Show `facets` as the active ones. */
  showFacets(facets: readonly ReadingStateFacet[]): void {
    this.#patch({ facets });
  }

  /** The researcher turned `facet` on or off. */
  toggleFacet(facet: ReadingStateFacet): void {
    const { facets } = this.state;
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
    this.#patch({ all });
    this.refresh();
  }

  /** Show `expanded` as the nodes open to their children. */
  showExpanded(expanded: readonly string[]): void {
    this.#patch({ expanded: new Set(expanded) });
  }

  /** The researcher opened or closed the node `key`. */
  toggle(key: string, open: boolean): void {
    const expanded = new Set(this.state.expanded);
    if (open) expanded.add(key);
    else expanded.delete(key);
    this.#host.expand([...expanded]);
  }

  /** Show the tree over the list on a narrow pane, or hide it. */
  setOpen(open: boolean): void {
    this.#patch({ open });
  }

  /** Show the tree collapsed beside a wide list, or shown. */
  showCollapsed(collapsed: boolean): void {
    this.#patch({ collapsed });
  }

  /** The researcher collapsed the tree beside a wide list, or showed it. */
  setCollapsed(collapsed: boolean): void {
    this.#host.collapse(collapsed);
  }

  /** The count of the selected node; `null` while unknown. */
  get count(): number | null {
    const { libraries, node } = this.state;
    return libraries ? (findNode(libraries, node)?.count ?? null) : null;
  }

  /** Whether some Library of the database lies outside the Library Scope. */
  get canWiden(): boolean {
    return this.registry.get(this.model.canWiden);
  }

  refresh(): void {
    this.#update(refreshTree);
  }

  /** Draw the tree into `el`. */
  render(el: HTMLElement): void {
    this.#mount(el, <TreePane tree={this} />);
  }

  /**
   * Draw into `el` the button that shows and hides the tree: over the list
   * on a narrow pane, and beside it on a wide one.
   */
  renderToggle(el: HTMLElement): void {
    this.#mount(el, <TreeToggle tree={this} />);
  }

  #mount(el: HTMLElement, content: ReactNode): void {
    const root = createRoot(el);
    root.render(
      <ViewRegistryProvider registry={this.registry}>
        <TreeModelProvider value={this.model}>{content}</TreeModelProvider>
      </ViewRegistryProvider>,
    );
    this.#roots.push(root);
  }
}

/** The name of a node: Recent, its Library's, or its Collection path. */
export function nodeLabel(
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

function TreeToggle({ tree }: { tree: LibraryTree }) {
  const open = useTreeState((s) => s.open);
  const collapsed = useTreeState((s) => s.collapsed);
  return (
    // Obsidian's own rule shows a clickable icon, so each pane width shows
    // and hides a wrapper: a narrow pane shows the tree over the list for a
    // while, and a wide one keeps it beside the list or collapsed.
    <>
      <span className="zt:flex zt:@xl:hidden">
        <IconButton
          icon="library"
          data-library-tree-toggle=""
          pressed={open}
          {...tooltipAttrs(m.library_view_show_tree())}
          onClick={() => tree.setOpen(!open)}
        />
      </span>
      <span className="zt:hidden zt:@xl:flex">
        <IconButton
          icon="library"
          data-library-tree-collapse=""
          pressed={!collapsed}
          {...tooltipAttrs(m.library_view_show_tree())}
          onClick={() => tree.setCollapsed(!collapsed)}
        />
      </span>
    </>
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

/** The icon of a node, as Zotero's collection tree draws one. */
export function nodeIcon(node: LibraryNode): IconName {
  if (node.kind === "recent") return "clock";
  if (node.kind === "collection") return "folder";
  return node.library.type === "group" ? "users" : "library";
}

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
    const open = !expanded.has(`${CLOSED_PREFIX}${key}`);
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
  const libraries = useTreeState((s) => s.libraries);
  const node = useTreeState((s) => s.node);
  const expanded = useTreeState((s) => s.expanded);
  const all = useTreeState((s) => s.all);
  const listed = useTreeState((s) => s.listed);
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
      ? tree.toggle(`${CLOSED_PREFIX}${row.key}`, !value)
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
    // name from the heading on screen; the tree alone goes by it.
    <nav className="zt:flex zt:flex-col zt:gap-(--size-4-2) zt:p-(--size-4-2)">
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
              aria-selected={listed && row.key === selected}
              aria-expanded={row.expanded ?? undefined}
              tabIndex={
                row.key === selected ||
                (index === 0 && !shown.some((r) => r.key === selected))
                  ? 0
                  : -1
              }
              style={{ "--zt-library-depth": row.level - 1 } as CSSProperties}
              className="zt:group zt:flex zt:min-w-0 zt:cursor-(--cursor) zt:items-center zt:gap-(--size-2-1) zt:rounded-(--radius-s) zt:py-(--size-2-2) zt:ps-[calc(var(--zt-library-depth)*var(--size-4-4)+var(--size-2-1))] zt:pe-(--size-4-2) zt:text-(length:--nav-item-size) zt:text-(--nav-item-color) zt:outline-hidden zt:hover:not-aria-selected:bg-(--nav-item-background-hover) zt:focus-visible:shadow-[inset_0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:aria-selected:bg-(--nav-item-background-selected) zt:aria-selected:text-(--nav-item-color-selected)"
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
              {/* Decoration: the label names the node. The chevron keeps the
                  row's narrow gap; the label stands 6 px off the icon, as a
                  button's does, and the icon takes the selected row's ink. */}
              <Icon
                name={nodeIcon(row.node)}
                size="s"
                className="zt:me-(--size-2-2) zt:shrink-0 zt:text-(--icon-color) zt:group-aria-selected:text-(--nav-item-color-selected)"
                data-library-icon={nodeIcon(row.node)}
              />
              <span
                data-library-label=""
                className="zt:min-w-0 zt:flex-1 zt:truncate"
              >
                {row.label}
              </span>
              {row.count !== null && (
                <span
                  data-library-count=""
                  className="zt:shrink-0 zt:text-(length:--font-ui-smaller) zt:text-muted-foreground zt:tabular-nums"
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
      {/* The toggle ends the Libraries it widens. The "Libraries" label is
          inside the tree, hidden from assistive technology, which allows no
          control there, so the toggle stands right under the last Library. */}
      {(all || tree.canWiden) && (
        <TextAction
          data-library-all={all ? "on" : "off"}
          className="zt:self-start zt:px-(--size-4-2) zt:text-(length:--font-ui-smaller)"
          onActivate={() => tree.showAll(!all)}
        >
          <Icon name={all ? "eye-off" : "eye"} size="xs" />
          {all
            ? m.library_view_scope_libraries()
            : m.library_view_all_libraries()}
        </TextAction>
      )}
      <Facets tree={tree} />
      <TagSelector tree={tree} />
    </nav>
  );
}

/** The name each Reading State facet goes by on screen. */
export const FACET_LABELS: Record<ReadingStateFacet, () => string> = {
  unread: m.library_view_facet_unread,
  annotated: m.library_view_facet_annotated,
  "has-note": m.library_view_facet_has_note,
  pdf: m.library_view_facet_pdf,
};

/** The Reading State facets, each a toggle that narrows the list. */
function Facets({ tree }: { tree: LibraryTree }) {
  const facets = useTreeState((s) => s.facets);
  const headingId = useUniqueId();
  return (
    // Named by a hidden heading: an `aria-label` would show a tooltip, and
    // the chips say on screen what they do.
    <div
      role="group"
      aria-labelledby={headingId}
      data-library-facets=""
      className="zt:flex zt:flex-col zt:gap-(--size-2-2)"
    >
      <span id={headingId} className="zt:sr-only">
        {m.library_view_facets_label()}
      </span>
      <div className="zt:flex zt:flex-wrap zt:gap-(--size-2-2) zt:px-(--size-4-2)">
        {READING_STATE_FACETS.map((facet) => (
          // Drawn as the tags of the Tag Selector are: on an element of its
          // own.
          <div
            key={facet}
            role="button"
            tabIndex={0}
            data-library-facet={facet}
            aria-pressed={facets.includes(facet)}
            className={FILTER_CHIP_CLASS}
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
