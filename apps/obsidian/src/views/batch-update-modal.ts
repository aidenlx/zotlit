import { type App, Modal, Setting, setIcon } from "obsidian";

import { BaseNotice } from "@/lib/notice";
import { cn } from "@/lib/utils";
import * as m from "@/paraglide/messages";

export type BatchUpdateTaskKind = "update" | "create";

export interface BatchUpdateDisplayTask {
  id: number;
  label: string;
  kind: BatchUpdateTaskKind;
}

export interface BatchUpdateDisplayNotFound {
  label: string;
}

export interface BatchUpdateClassifyControls {
  /**
   * Reports how many ids have been classified so far, driving the loading bar.
   * The modal already knows the total (the id count passed at construction).
   */
  onProgress: (classified: number) => void;
  signal: AbortSignal;
}

export interface BatchUpdateClassifyResult {
  tasks: BatchUpdateDisplayTask[];
  notFound: BatchUpdateDisplayNotFound[];
}

export interface BatchUpdateRunControls {
  /**
   * Reports a single item reaching a terminal state. The modal owns the running
   * counts and flips the item's checklist row in place; queued work that is
   * aborted never settles, so `done` stays below `total` on cancel. A failure
   * carries its formatted error so the run phase can list it live, above the
   * in-flight update/create groups.
   */
  onItemSettled: (
    event:
      | { id: number; status: "done" }
      | { id: number; status: "failed"; failure: BatchUpdateFailure },
  ) => void;
  signal: AbortSignal;
}

export interface BatchUpdateRunResult {
  created: number;
  updated: number;
  failed: number;
  cancelled: boolean;
  failures: BatchUpdateFailure[];
}

export interface BatchUpdateFailure {
  label: string;
  message: string;
}

export interface BatchUpdateModalOptions {
  /** Total ids being classified, for the loading-phase progress bar. */
  total: number;
  /**
   * Resolves the ids into the display tasks + not-found list. Runs as the
   * modal's loading phase, reporting progress and honoring the abort signal;
   * the modal renders its result into the confirm checklist.
   */
  onClassify: (
    controls: BatchUpdateClassifyControls,
  ) => Promise<BatchUpdateClassifyResult>;
  onRun: (controls: BatchUpdateRunControls) => Promise<BatchUpdateRunResult>;
}

type RowStatus = "pending" | "done" | "failed";

const ROW_ICON: Record<RowStatus, string> = {
  pending: "circle-dashed",
  done: "check",
  failed: "x",
};

const ROW_ICON_CLASS: Record<RowStatus, string> = {
  pending: "zt:text-(--text-faint)",
  done: "zt:text-(--text-success)",
  failed: "zt:text-(--text-error)",
};

const ICON_CLS = "zt:flex zt:shrink-0";
/**
 * Sticky category label (Obsidian UI-smaller scale, not an editor heading): it
 * pins to the top of the scroll region so the current group stays labeled while
 * its rows scroll, over a modal-surface background that hides them underneath.
 */
const SECTION_SUMMARY_CLS =
  "zt:sticky zt:top-0 zt:z-10 zt:mb-1 zt:cursor-pointer zt:select-none zt:bg-(--modal-background) zt:py-1 zt:text-xs zt:font-semibold zt:uppercase zt:tracking-wide zt:text-(--text-muted)";
/** Groups larger than this start collapsed, so the modal opens on a compact
 * overview of group headers and the user can collapse past a group of thousands
 * to reach the next one instead of scrolling through it. */
const SECTION_OPEN_MAX = 50;
// `content-visibility: auto` lets the browser skip layout/paint for off-screen
// rows in an expanded group while keeping every <li> (and its updatable status
// icon) live in the DOM; the intrinsic-size estimate keeps the scrollbar steady.
const ROW_CLS =
  "zt:flex zt:items-center zt:gap-2 zt:py-0.5 zt:min-w-0 zt:[content-visibility:auto] zt:[contain-intrinsic-size:auto_1.5rem]";
const ROW_LABEL_CLS = "zt:truncate zt:text-sm zt:text-(--text-normal)";

/**
 * Imperative loading → confirm → progress → summary modal for a batch run, in a
 * single fixed-size shell (matches the `setting-tab/frontmatter-modal.ts` style,
 * not React). The phases swap the body content and footer buttons but never
 * resize the window: the body is a `flex-1` scroll region between an auto-height
 * header and footer.
 *
 * The loading phase runs {@link BatchUpdateModalOptions.onClassify} behind a
 * determinate bar (the only true UI-freeze risk is there — the synchronous DB
 * classification — so it yields between chunks while this bar paints). Run
 * progress is a determinate bar driven by per-item
 * {@link BatchUpdateRunControls.onItemSettled} events; the per-item checklist is
 * collapsed behind a disclosure and updated in place. Execution is delegated to
 * {@link BatchUpdateModalOptions.onRun}; cancel aborts queued work while
 * in-flight items finish.
 */
export class BatchUpdateModal extends Modal {
  readonly #total: number;
  readonly #onClassify: BatchUpdateModalOptions["onClassify"];
  readonly #onRun: BatchUpdateModalOptions["onRun"];
  /** Populated by {@link #classify} once the loading phase resolves. */
  #tasks: BatchUpdateDisplayTask[] = [];
  #notFound: BatchUpdateDisplayNotFound[] = [];
  #runAbort: AbortController | null = null;
  #dismissed = false;

  /** Per-row status icon element, keyed by task id, for in-place updates. */
  readonly #rowIcons = new Map<number, HTMLElement>();
  /** Terminal status per task id; the single source for progress counts. Absent
   * ids were aborted before running. */
  readonly #finalStatus = new Map<number, "done" | "failed">();
  #barFill: HTMLElement | null = null;
  #countEl: HTMLElement | null = null;
  #failedEl: HTMLElement | null = null;
  /** Live failed-panel refs for the run phase: the pinned `<details>` (hidden
   * until the first failure), its count summary, and the list to append rows to.
   * Failures accumulate here as their settle events arrive. */
  #failedPanel: HTMLElement | null = null;
  #failedPanelSummary: HTMLElement | null = null;
  #failedPanelList: HTMLElement | null = null;
  readonly #failures: BatchUpdateFailure[] = [];

  constructor(app: App, options: BatchUpdateModalOptions) {
    super(app);
    this.#total = options.total;
    this.#onClassify = options.onClassify;
    this.#onRun = options.onRun;
  }

  override onOpen(): void {
    this.setTitle(m.batch_update_title());
    this.contentEl.addClass("zt-root");
    void this.#classify();
  }

  override onClose(): void {
    // A window dismissal mid-classify or mid-run also aborts: both loops check
    // the signal between chunks/items, and #dismissed suppresses the now-detached
    // confirm/summary render.
    this.#dismissed = true;
    this.#runAbort?.abort();
    this.contentEl.empty();
  }

  /**
   * Loading phase: drive {@link #onClassify} behind a determinate bar, then hand
   * its result to the confirm phase. Cancel/dismiss aborts and closes silently
   * (nothing has been written yet); a genuine failure surfaces a notice.
   */
  async #classify(): Promise<void> {
    this.#renderLoading();
    const abort = new AbortController();
    this.#runAbort = abort;

    let result: BatchUpdateClassifyResult;
    try {
      result = await this.#onClassify({
        onProgress: (classified) => this.#setBar(classified, this.#total),
        signal: abort.signal,
      });
    } catch {
      // Cancel button and window dismissal both route through onClose, which
      // sets #dismissed and aborts; the resulting AbortError lands here with
      // nothing left to render.
      if (!this.#dismissed) {
        new BaseNotice(m.batch_update_load_failed());
        this.close();
      }
      return;
    } finally {
      this.#runAbort = null;
    }

    if (this.#dismissed) return;
    this.#tasks = result.tasks;
    this.#notFound = result.notFound;
    this.#renderConfirm();
  }

  /** Fixed-height flex shell: caller fills the returned body region. */
  #renderShell(): HTMLElement {
    const { contentEl } = this;
    contentEl.empty();
    const shell = contentEl.createDiv({
      cls: "zt:flex zt:flex-col zt:h-[60vh]",
    });
    return shell;
  }

  #renderConfirm(): void {
    const shell = this.#renderShell();
    const actionable = this.#tasks.length;
    shell.createEl("p", {
      text:
        actionable === 0
          ? m.batch_update_confirm_none({ count: this.#notFound.length })
          : m.batch_update_confirm_intro({ count: actionable }),
      cls: "zt:shrink-0 zt:mb-3 zt:text-(--text-normal)",
    });
    const body = shell.createDiv({
      cls: "zt:flex-1 zt:min-h-0 zt:overflow-y-auto",
    });
    this.#renderChecklist(body);

    new Setting(shell)
      .addButton((btn) =>
        btn.setButtonText(m.modal_cancel()).onClick(() => this.close()),
      )
      .addButton((btn) =>
        btn
          .setButtonText(m.batch_update_confirm_button())
          .setCta()
          .onClick(() => void this.#run()),
      );
  }

  /**
   * Loading phase: a determinate "classified / total" bar over the synchronous
   * DB classification. Cancel aborts it (closing the modal); since nothing is
   * written during classification, the close is silent.
   */
  #renderLoading(): void {
    const shell = this.#renderShell();
    const headline = this.#renderBarHeadline(
      shell,
      m.batch_update_loading_label(),
      // No width transition: classification can finish faster than the 200ms
      // ease, leaving the bar mid-animation when the confirm phase replaces it
      // while the count already reads 100%.
      false,
    );
    this.#countEl = headline.createDiv({
      cls: "zt:text-sm zt:tabular-nums zt:text-(--text-muted)",
    });
    this.#setBar(0, this.#total);
    // Spacer fills the fixed-height shell so the footer stays pinned to the bottom.
    shell.createDiv({ cls: "zt:flex-1 zt:min-h-0" });

    new Setting(shell).addButton((btn) =>
      btn.setButtonText(m.modal_cancel()).onClick(() => this.close()),
    );
  }

  #renderProgress(): void {
    const shell = this.#renderShell();
    const headline = this.#renderBarHeadline(
      shell,
      m.batch_update_progress_label(),
    );
    const counts = headline.createDiv({
      cls: "zt:flex zt:gap-3 zt:text-sm zt:tabular-nums zt:text-(--text-muted)",
    });
    this.#countEl = counts.createSpan();
    this.#failedEl = counts.createSpan({ cls: "zt:text-(--text-error)" });
    this.#updateProgress();

    const warning = shell.createDiv({
      cls: "zt:shrink-0 zt:flex zt:items-center zt:gap-2 zt:mb-2 zt:text-xs zt:text-(--text-warning)",
    });
    setIcon(warning.createSpan({ cls: ICON_CLS }), "triangle-alert");
    warning.createSpan({ text: m.batch_update_progress_warning() });

    this.#renderFailedPanel(shell);
    this.#renderChecklist(this.#renderDisclosure(shell, false));

    new Setting(shell).addButton((btn) =>
      btn.setButtonText(m.modal_cancel()).onClick(() => {
        this.#runAbort?.abort();
        btn.setButtonText(m.batch_update_cancelling()).setDisabled(true);
      }),
    );
  }

  /**
   * Live failures panel for the run phase: a bounded, scrollable section pinned
   * above the (collapsed) details disclosure so errors surface as they happen
   * instead of waiting for the summary. Starts hidden; {@link #addFailure}
   * reveals it and updates the count as failures arrive.
   */
  #renderFailedPanel(parent: HTMLElement): void {
    const details = parent.createEl("details", {
      cls: "zt:shrink-0 zt:mb-2 zt:max-h-32 zt:overflow-y-auto",
      attr: { open: "" },
    });
    details.toggle(false);
    this.#failedPanel = details;
    this.#failedPanelSummary = details.createEl("summary", {
      cls: cn(SECTION_SUMMARY_CLS, "zt:text-(--text-error)"),
    });
    this.#failedPanelList = details.createEl("ul", {
      cls: "zt:m-0 zt:list-none zt:p-0",
    });
  }

  /** Record a failure and, while the run-phase panel is mounted, append its row
   * and reveal the panel with an updated count. */
  #addFailure(failure: BatchUpdateFailure): void {
    this.#failures.push(failure);
    if (!this.#failedPanel || !this.#failedPanelList) return;
    this.#failureRow(this.#failedPanelList, failure);
    this.#failedPanel.toggle(true);
    this.#failedPanelSummary?.setText(
      m.batch_update_group_failed({ count: this.#failures.length }),
    );
  }

  /**
   * Shared headline: phase label above a determinate fill bar. Sets
   * {@link #barFill}. `animate` adds a width ease for the run phase, where items
   * settle over real time; the loading phase omits it (see {@link #renderLoading}).
   */
  #renderBarHeadline(
    shell: HTMLElement,
    label: string,
    animate = true,
  ): HTMLElement {
    const headline = shell.createDiv({
      cls: "zt:shrink-0 zt:flex zt:flex-col zt:gap-2 zt:py-2",
    });
    headline.createEl("p", {
      text: label,
      cls: "zt:m-0 zt:text-base zt:font-medium zt:text-(--text-normal)",
    });
    const track = headline.createDiv({
      cls: "zt:h-2 zt:w-full zt:rounded-full zt:overflow-hidden zt:bg-(--background-modifier-border)",
    });
    this.#barFill = track.createDiv({
      cls: cn(
        "zt:h-full zt:rounded-full zt:bg-(--interactive-accent)",
        animate && "zt:transition-[width] zt:duration-200",
      ),
    });
    return headline;
  }

  /**
   * The grouped item list reused across confirm and progress. Update/create
   * rows register their status icon under {@link #rowIcons} so the run can flip
   * them in place; not-found rows are static.
   */
  #renderChecklist(parent: HTMLElement): void {
    const { update = [], create = [] } = Object.groupBy(
      this.#tasks,
      (task) => task.kind,
    );
    this.#renderTaskGroup(
      parent,
      m.batch_update_group_update({ count: update.length }),
      update,
    );
    this.#renderTaskGroup(
      parent,
      m.batch_update_group_create({ count: create.length }),
      create,
    );
    this.#listGroup(parent, {
      header: m.batch_update_group_not_found({ count: this.#notFound.length }),
      items: this.#notFound,
      icon: "minus",
      colorCls: "zt:text-(--text-muted)",
    });
  }

  /** A static (non-updating) section of icon + label rows, skipped when empty. */
  #listGroup(
    parent: HTMLElement,
    group: {
      header: string;
      items: readonly { label: string }[];
      icon: string;
      colorCls: string;
    },
  ): void {
    if (group.items.length === 0) return;
    const ul = this.#section(
      parent,
      group.header,
      group.items.length <= SECTION_OPEN_MAX,
    );
    for (const item of group.items) {
      const icon = this.#row(ul, item.label);
      icon.addClass(group.colorCls);
      setIcon(icon, group.icon);
    }
  }

  #renderTaskGroup(
    parent: HTMLElement,
    header: string,
    tasks: readonly BatchUpdateDisplayTask[],
  ): void {
    if (tasks.length === 0) return;
    const ul = this.#section(parent, header, tasks.length <= SECTION_OPEN_MAX);
    for (const task of tasks) {
      const icon = this.#row(ul, task.label);
      icon.addClass(ROW_ICON_CLASS.pending);
      setIcon(icon, ROW_ICON.pending);
      this.#rowIcons.set(task.id, icon);
    }
  }

  /**
   * A `flex-1` scroll region behind a "Show/Hide details" disclosure; the
   * summary text tracks the open state. Returns the `<details>` to fill.
   */
  #renderDisclosure(parent: HTMLElement, open: boolean): HTMLElement {
    const details = parent.createEl("details", {
      cls: "zt:flex-1 zt:min-h-0 zt:overflow-y-auto",
      attr: open ? { open: "" } : {},
    });
    const summary = details.createEl("summary", {
      cls: "zt:cursor-pointer zt:text-sm zt:text-(--text-muted) zt:py-1",
      text: open
        ? m.batch_update_details_hide()
        : m.batch_update_details_show(),
    });
    details.addEventListener("toggle", () => {
      summary.setText(
        details.open
          ? m.batch_update_details_hide()
          : m.batch_update_details_show(),
      );
    });
    return details;
  }

  /** Collapsible titled section: a sticky summary label above a reset `<ul>`;
   * `open` starts the group expanded (see {@link SECTION_OPEN_MAX}). */
  #section(parent: HTMLElement, header: string, open: boolean): HTMLElement {
    const details = parent.createEl("details", {
      cls: "zt:mb-4 zt:last:mb-0",
      attr: open ? { open: "" } : {},
    });
    details.createEl("summary", { text: header, cls: SECTION_SUMMARY_CLS });
    return details.createEl("ul", { cls: "zt:m-0 zt:list-none zt:p-0" });
  }

  /** One checklist row: a leading icon span (returned for status styling) and a
   * truncated label whose full text shows as a hover tooltip. */
  #row(ul: HTMLElement, label: string): HTMLElement {
    const li = ul.createEl("li", { cls: ROW_CLS });
    const icon = li.createSpan({ cls: ICON_CLS });
    li.createSpan({
      text: label,
      cls: ROW_LABEL_CLS,
      attr: { "aria-label": label },
    });
    return icon;
  }

  /** A failed-item row: an x-icon + truncated label, with the error message on a
   * second muted line indented under the label. Shared by the live run-phase
   * panel and the summary's Failed group. */
  #failureRow(ul: HTMLElement, failure: BatchUpdateFailure): void {
    const li = ul.createEl("li", { cls: "zt:py-0.5 zt:min-w-0" });
    const row = li.createDiv({
      cls: "zt:flex zt:items-center zt:gap-2 zt:min-w-0",
    });
    setIcon(row.createSpan({ cls: `${ICON_CLS} zt:text-(--text-error)` }), "x");
    row.createSpan({
      text: failure.label,
      cls: "zt:truncate zt:text-sm",
      attr: { "aria-label": failure.label },
    });
    li.createDiv({
      text: failure.message,
      cls: "zt:text-xs zt:text-(--text-muted) zt:pl-6",
    });
  }

  #setRowStatus(id: number, status: Exclude<RowStatus, "pending">): void {
    const icon = this.#rowIcons.get(id);
    if (!icon) return;
    icon.className = `${ICON_CLS} ${ROW_ICON_CLASS[status]}`;
    setIcon(icon, ROW_ICON[status]);
  }

  /** Drive the determinate bar + count line shared by the loading and run phases. */
  #setBar(done: number, total: number): void {
    const pct = total === 0 ? 100 : Math.round((done / total) * 100);
    if (this.#barFill) this.#barFill.style.width = `${pct}%`;
    this.#countEl?.setText(m.batch_update_progress_count({ done, total, pct }));
  }

  #updateProgress(): void {
    const total = this.#tasks.length;
    const failed = [...this.#finalStatus.values()].filter(
      (status) => status === "failed",
    ).length;
    this.#setBar(this.#finalStatus.size, total);
    if (this.#failedEl) {
      this.#failedEl.toggle(failed > 0);
      if (failed > 0) {
        this.#failedEl.setText(
          m.batch_update_progress_failed({ count: failed }),
        );
      }
    }
  }

  async #run(): Promise<void> {
    this.#renderProgress();
    const abort = new AbortController();
    this.#runAbort = abort;

    let result: BatchUpdateRunResult;
    try {
      result = await this.#onRun({
        onItemSettled: (event) => {
          this.#finalStatus.set(event.id, event.status);
          this.#setRowStatus(event.id, event.status);
          if (event.status === "failed") this.#addFailure(event.failure);
          this.#updateProgress();
        },
        signal: abort.signal,
      });
    } finally {
      this.#runAbort = null;
    }

    if (this.#dismissed) {
      new BaseNotice(
        m.batch_update_aborted({
          created: result.created,
          updated: result.updated,
          failed: result.failed,
        }),
      );
      return;
    }

    const summary = result.cancelled
      ? m.batch_update_summary_cancelled({
          created: result.created,
          updated: result.updated,
          failed: result.failed,
        })
      : m.batch_update_summary({
          created: result.created,
          updated: result.updated,
          failed: result.failed,
        });
    new BaseNotice(summary);
    this.#renderSummary(summary, result.failures);
  }

  /**
   * Full outcome-grouped list with Failed pinned first, then completed
   * update/create, not-found, and any items aborted before running. The
   * disclosure auto-opens only when there were failures.
   */
  #renderSummary(summary: string, failures: BatchUpdateFailure[]): void {
    // The progress-phase DOM (its row icons and live failed panel) is gone after
    // #renderShell; release the detached element references.
    this.#rowIcons.clear();
    this.#failedPanel = null;
    this.#failedPanelSummary = null;
    this.#failedPanelList = null;
    const shell = this.#renderShell();
    shell.createEl("p", {
      text: summary,
      cls: "zt:shrink-0 zt:mb-1 zt:text-base zt:text-(--text-normal)",
    });

    const details = this.#renderDisclosure(shell, failures.length > 0);

    if (failures.length > 0) {
      const ul = this.#section(
        details,
        m.batch_update_group_failed({ count: failures.length }),
        true,
      );
      for (const failure of failures) this.#failureRow(ul, failure);
    }

    const { update = [], create = [] } = Object.groupBy(
      this.#tasks.filter((task) => this.#finalStatus.get(task.id) === "done"),
      (task) => task.kind,
    );
    this.#listGroup(details, {
      header: m.batch_update_group_update({ count: update.length }),
      items: update,
      icon: ROW_ICON.done,
      colorCls: ROW_ICON_CLASS.done,
    });
    this.#listGroup(details, {
      header: m.batch_update_group_create({ count: create.length }),
      items: create,
      icon: ROW_ICON.done,
      colorCls: ROW_ICON_CLASS.done,
    });
    this.#listGroup(details, {
      header: m.batch_update_group_not_found({ count: this.#notFound.length }),
      items: this.#notFound,
      icon: "minus",
      colorCls: "zt:text-(--text-muted)",
    });
    const skipped = this.#tasks.filter(
      (task) => !this.#finalStatus.has(task.id),
    );
    this.#listGroup(details, {
      header: m.batch_update_group_skipped({ count: skipped.length }),
      items: skipped,
      icon: ROW_ICON.pending,
      colorCls: ROW_ICON_CLASS.pending,
    });

    new Setting(shell).addButton((btn) =>
      btn
        .setButtonText(m.batch_update_close())
        .setCta()
        .onClick(() => this.close()),
    );
  }
}
