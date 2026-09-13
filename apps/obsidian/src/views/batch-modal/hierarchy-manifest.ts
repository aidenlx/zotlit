// Parent → child-note tree body for the batch modal (import child notes).
import {
  listGroup,
  ROW_ICON,
  ROW_ICON_CLASS,
  row,
  SECTION_OPEN_MAX,
  setRowIcon,
} from "./dom";
import type { FlatTask } from "./flat-manifest";
import type { BatchCounts, BatchManifest } from "./types";

export interface HierarchyParent {
  label: string;
  children: readonly FlatTask[];
}

export interface HierarchyManifestOptions {
  parents: readonly HierarchyParent[];
  /** Items classified as up-to-date; shown as a static informational group. */
  upToDate?: readonly { label: string }[];
  upToDateHeader?: (args: { count: number }) => string;
  doneHeader: (args: { count: number }) => string;
  /** Header for items that ran but had nothing to write (e.g. vanished note). */
  skippedHeader?: (args: { count: number }) => string;
  /** Header for items that never ran (cancelled before executing). */
  abortedHeader: (args: { count: number }) => string;
}

/**
 * Parent → child-note tree: each parent is a collapsible section labeled with
 * its display title; its child notes are indented status rows keyed by child
 * item id. The confirm and progress phases show the tree; the summary regroups
 * children flat by terminal status (the shell already lists failures), matching
 * the {@link FlatManifest} recap.
 */
export class HierarchyManifest implements BatchManifest {
  readonly #options: HierarchyManifestOptions;
  readonly #rowIcons = new Map<number, HTMLElement>();
  /** Flattened child tasks across all parents, for counts and summary grouping. */
  readonly #children: readonly FlatTask[];

  constructor(options: HierarchyManifestOptions) {
    this.#options = options;
    this.#children = options.parents.flatMap((parent) => parent.children);
  }

  get counts(): BatchCounts {
    return { actionable: this.#children.length, notFound: 0 };
  }

  renderList(parent: HTMLElement): void {
    this.#rowIcons.clear();
    for (const node of this.#options.parents) {
      if (node.children.length === 0) continue;
      const details = parent.createEl("details", {
        cls: "zt:mb-4 zt:last:mb-0",
        attr: node.children.length <= SECTION_OPEN_MAX ? { open: "" } : {},
      });
      const summary = details.createEl("summary", {
        cls: "zt:sticky zt:top-0 zt:z-10 zt:mb-1 zt:cursor-pointer zt:select-none zt:bg-(--modal-background) zt:py-1 zt:flex zt:items-center zt:gap-2 zt:min-w-0",
      });
      summary.createSpan({
        text: node.label,
        cls: "zt:truncate zt:text-sm zt:font-medium zt:text-(--text-normal)",
        attr: { "aria-label": node.label },
      });
      summary.createSpan({
        text: `(${node.children.length})`,
        cls: "zt:shrink-0 zt:text-xs zt:tabular-nums zt:text-(--text-muted)",
      });
      const ul = details.createEl("ul", { cls: "zt:m-0 zt:list-none zt:p-0" });
      for (const child of node.children) {
        const icon = row(ul, child.label, { indent: true });
        setRowIcon(icon, "pending");
        this.#rowIcons.set(child.id, icon);
      }
    }
    this.#renderUpToDate(parent);
  }

  #renderUpToDate(parent: HTMLElement): void {
    const items = this.#options.upToDate;
    if (!items?.length || !this.#options.upToDateHeader) return;
    listGroup(parent, {
      header: this.#options.upToDateHeader({ count: items.length }),
      items,
      icon: "check",
      colorCls: "zt:text-(--text-muted)",
    });
  }

  setRowStatus(id: number, status: "done" | "skipped" | "failed"): void {
    const icon = this.#rowIcons.get(id);
    if (icon) setRowIcon(icon, status);
  }

  renderSummary(
    parent: HTMLElement,
    finalStatus: ReadonlyMap<number, "done" | "skipped" | "failed">,
  ): void {
    this.#rowIcons.clear();
    const done = this.#children.filter(
      (child) => finalStatus.get(child.id) === "done",
    );
    listGroup(parent, {
      header: this.#options.doneHeader({ count: done.length }),
      items: done,
      icon: ROW_ICON.done,
      colorCls: ROW_ICON_CLASS.done,
    });
    this.#renderUpToDate(parent);
    if (this.#options.skippedHeader) {
      const skipped = this.#children.filter(
        (child) => finalStatus.get(child.id) === "skipped",
      );
      listGroup(parent, {
        header: this.#options.skippedHeader({ count: skipped.length }),
        items: skipped,
        icon: ROW_ICON.skipped,
        colorCls: ROW_ICON_CLASS.skipped,
      });
    }
    const aborted = this.#children.filter(
      (child) => !finalStatus.has(child.id),
    );
    listGroup(parent, {
      header: this.#options.abortedHeader({ count: aborted.length }),
      items: aborted,
      icon: ROW_ICON.pending,
      colorCls: ROW_ICON_CLASS.pending,
    });
  }
}
