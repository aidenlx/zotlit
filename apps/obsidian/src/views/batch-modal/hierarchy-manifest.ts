// Parent → child-note tree body for the batch modal (import child notes).
import { cn } from "@/lib/utils";

import {
  GROUP_SUMMARY_CLS,
  listGroup,
  ROW_ICON,
  ROW_ICON_CLASS,
  rowGroup,
  RowStatusBoard,
  profileChoiceControl,
  profileListGroup,
} from "./dom";
import type { BatchRow } from "./dom";
import type { FlatTask } from "./flat-manifest";
import type {
  BatchCounts,
  BatchManifest,
  BatchListControls,
  BatchProfileChoice,
} from "./types";

export interface HierarchyParent {
  label: string;
  children: readonly FlatTask[];
  profileChoice?: BatchProfileChoice;
}

export interface HierarchyManifestOptions {
  parents: readonly HierarchyParent[];
  /** Items classified as up-to-date; shown as a static informational group. */
  upToDate?: readonly BatchRow[];
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
  readonly #rows = new RowStatusBoard();
  /** Flattened child tasks across all parents, for counts and summary grouping. */
  readonly #children: readonly FlatTask[];

  constructor(options: HierarchyManifestOptions) {
    this.#options = options;
    this.#children = options.parents.flatMap((parent) => parent.children);
  }

  get counts(): BatchCounts {
    return { actionable: this.#children.length, notFound: 0 };
  }

  renderList(parent: HTMLElement, controls?: BatchListControls): void {
    this.#rows.unmount();
    for (const node of this.#options.parents) {
      if (node.children.length === 0) continue;
      const summary = rowGroup(
        parent,
        cn(GROUP_SUMMARY_CLS, "zt:flex zt:min-w-0 zt:items-center zt:gap-2"),
        {
          items: node.children,
          renderRow: (ul, child) =>
            this.#rows.mount(ul, { ...child, indent: true }),
        },
      );
      summary.createSpan({
        text: node.label,
        cls: "zt:truncate zt:text-sm zt:font-medium zt:text-(--text-normal)",
        attr: { "aria-label": node.label },
      });
      if (node.profileChoice)
        profileChoiceControl(summary, node.profileChoice, controls);
      summary.createSpan({
        text: `(${node.children.length})`,
        cls: "zt:shrink-0 zt:text-xs zt:tabular-nums zt:text-(--text-muted)",
      });
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
    this.#rows.set(id, status);
  }

  renderSummary(
    parent: HTMLElement,
    finalStatus: ReadonlyMap<number, "done" | "skipped" | "failed">,
  ): void {
    this.#rows.unmount();
    const done = this.#children.filter(
      (child) => finalStatus.get(child.id) === "done",
    );
    profileListGroup(parent, {
      header: this.#options.doneHeader({ count: done.length }),
      profileHeader: this.#options.doneHeader,
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
