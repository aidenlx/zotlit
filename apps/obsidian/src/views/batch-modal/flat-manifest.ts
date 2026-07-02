// Flat grouped-checklist body for the batch modal (update/create, create/overwrite).
import {
  listGroup,
  ROW_ICON,
  ROW_ICON_CLASS,
  row,
  section,
  SECTION_OPEN_MAX,
  setRowIcon,
} from "./dom";
import { type BatchCounts, type BatchManifest } from "./types";

export interface FlatTask {
  id: number;
  label: string;
  /** Group key; one of the {@link FlatManifestOptions.groups} kinds. */
  kind: string;
}

/** One confirm/summary group, in render order. */
export interface FlatGroupDef {
  kind: string;
  header: (args: { count: number }) => string;
}

export interface FlatManifestOptions {
  tasks: readonly FlatTask[];
  notFound: readonly { label: string }[];
  /** Ordered group definitions; tasks are bucketed by `kind`. */
  groups: readonly FlatGroupDef[];
  notFoundHeader: (args: { count: number }) => string;
  /** Header for items that ran but had nothing to write (e.g. vanished note). */
  skippedHeader?: (args: { count: number }) => string;
  /** Header for items that never ran (cancelled before executing). */
  abortedHeader: (args: { count: number }) => string;
}

/**
 * Flat checklist: ordered groups of tasks (each a leading status icon + label)
 * plus a static not-found group. Rows register their icon under {@link #rowIcons}
 * so a run can flip them in place; the summary regroups by terminal status.
 */
export class FlatManifest implements BatchManifest {
  readonly #options: FlatManifestOptions;
  /** Per-row status icon element, keyed by task id, for in-place updates. */
  readonly #rowIcons = new Map<number, HTMLElement>();

  constructor(options: FlatManifestOptions) {
    this.#options = options;
  }

  get counts(): BatchCounts {
    return {
      actionable: this.#options.tasks.length,
      notFound: this.#options.notFound.length,
    };
  }

  renderList(parent: HTMLElement): void {
    this.#rowIcons.clear();
    const byKind = Object.groupBy(this.#options.tasks, (task) => task.kind);
    for (const group of this.#options.groups) {
      const tasks = byKind[group.kind] ?? [];
      if (tasks.length === 0) continue;
      const ul = section(
        parent,
        group.header({ count: tasks.length }),
        tasks.length <= SECTION_OPEN_MAX,
      );
      for (const task of tasks) {
        const icon = row(ul, task.label);
        setRowIcon(icon, "pending");
        this.#rowIcons.set(task.id, icon);
      }
    }
    listGroup(parent, {
      header: this.#options.notFoundHeader({
        count: this.#options.notFound.length,
      }),
      items: this.#options.notFound,
      icon: "minus",
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
    const done = this.#options.tasks.filter(
      (task) => finalStatus.get(task.id) === "done",
    );
    const byKind = Object.groupBy(done, (task) => task.kind);
    for (const group of this.#options.groups) {
      listGroup(parent, {
        header: group.header({ count: (byKind[group.kind] ?? []).length }),
        items: byKind[group.kind] ?? [],
        icon: ROW_ICON.done,
        colorCls: ROW_ICON_CLASS.done,
      });
    }
    listGroup(parent, {
      header: this.#options.notFoundHeader({
        count: this.#options.notFound.length,
      }),
      items: this.#options.notFound,
      icon: "minus",
      colorCls: "zt:text-(--text-muted)",
    });
    if (this.#options.skippedHeader) {
      const skipped = this.#options.tasks.filter(
        (task) => finalStatus.get(task.id) === "skipped",
      );
      listGroup(parent, {
        header: this.#options.skippedHeader({ count: skipped.length }),
        items: skipped,
        icon: ROW_ICON.skipped,
        colorCls: ROW_ICON_CLASS.skipped,
      });
    }
    const aborted = this.#options.tasks.filter(
      (task) => !finalStatus.has(task.id),
    );
    listGroup(parent, {
      header: this.#options.abortedHeader({ count: aborted.length }),
      items: aborted,
      icon: ROW_ICON.pending,
      colorCls: ROW_ICON_CLASS.pending,
    });
  }
}
