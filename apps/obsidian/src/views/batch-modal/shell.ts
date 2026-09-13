import { Modal, Setting, setIcon } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { cn } from "@/lib/utils";
import type { BatchFailure } from "@/services/batch-run";

import { failureRow, ICON_CLS, section, SECTION_SUMMARY_CLS } from "./dom";
import type { BatchManifest, BatchModalOptions, BatchRunResult } from "./types";

/**
 * Imperative loading → confirm → progress → summary modal for a batch run, in a
 * single fixed-size shell (matches the `setting-tab/frontmatter-modal.ts` style,
 * not React). The phases swap the body content and footer buttons but never
 * resize the window: the body is a `flex-1` scroll region between an auto-height
 * header and footer.
 *
 * The loading phase runs {@link BatchModalOptions.onClassify} behind a
 * determinate bar (its synchronous DB classification is the only real UI-freeze
 * risk, so it yields between chunks while this bar paints) and yields the
 * {@link BatchManifest} the remaining phases render. Run progress is a
 * determinate bar driven by per-item {@link BatchRunControls.onItemSettled}
 * events; the per-item listing is collapsed behind a disclosure and updated in
 * place. Execution is delegated to {@link BatchModalOptions.onRun}; cancel
 * aborts queued work while in-flight items finish.
 */
export class BatchModal extends Modal {
  readonly #options: BatchModalOptions;
  /** Populated by {@link #classify} once the loading phase resolves. */
  #manifest: BatchManifest | null = null;
  #runAbort: AbortController | null = null;
  #dismissed = false;

  /** Terminal status per row id; the single source for progress counts. Absent
   * ids were aborted before running. */
  readonly #finalStatus = new Map<number, "done" | "skipped" | "failed">();
  #barFill: HTMLElement | null = null;
  #countEl: HTMLElement | null = null;
  #failedEl: HTMLElement | null = null;
  /** Live failed-panel refs for the run phase: the pinned `<details>` (hidden
   * until the first failure), its count summary, and the list to append rows to. */
  #failedPanel: HTMLElement | null = null;
  #failedPanelSummary: HTMLElement | null = null;
  #failedPanelList: HTMLElement | null = null;
  readonly #failures: BatchFailure[] = [];

  constructor(app: App, options: BatchModalOptions) {
    super(app);
    this.#options = options;
  }

  override onOpen(): void {
    this.setTitle(this.#options.text.title);
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

  get #manifestOrThrow(): BatchManifest {
    if (!this.#manifest) throw new Error("manifest not classified yet");
    return this.#manifest;
  }

  /**
   * Loading phase: drive {@link BatchModalOptions.onClassify} behind a
   * determinate bar, then hand its manifest to the confirm phase. Cancel/dismiss
   * aborts and closes silently (nothing has been written yet); a genuine failure
   * surfaces a notice.
   */
  async #classify(): Promise<void> {
    this.#renderLoading();
    const abort = new AbortController();
    this.#runAbort = abort;

    let manifest: BatchManifest;
    try {
      manifest = await this.#options.onClassify({
        onProgress: (classified) =>
          this.#setBar(classified, this.#options.total),
        signal: abort.signal,
      });
    } catch {
      // Cancel button and window dismissal both route through onClose, which
      // sets #dismissed and aborts; the resulting AbortError lands here with
      // nothing left to render.
      if (!this.#dismissed) {
        new BaseNotice(this.#options.text.loadFailed);
        this.close();
      }
      return;
    } finally {
      this.#runAbort = null;
    }

    if (this.#dismissed) return;
    this.#manifest = manifest;
    this.#renderConfirm();
  }

  /** Fixed-height flex shell: caller fills the returned body region. */
  #renderShell(): HTMLElement {
    const { contentEl } = this;
    contentEl.empty();
    return contentEl.createDiv({ cls: "zt:flex zt:flex-col zt:h-[60vh]" });
  }

  #renderConfirm(): void {
    const manifest = this.#manifestOrThrow;
    const shell = this.#renderShell();
    shell.createEl("p", {
      text: this.#options.text.confirmIntro(manifest.counts),
      cls: "zt:shrink-0 zt:mb-3 zt:text-(--text-normal)",
    });
    const body = shell.createDiv({
      cls: "zt:flex-1 zt:min-h-0 zt:overflow-y-auto",
    });
    manifest.renderList(body);

    const footer = new Setting(shell).addButton((btn) =>
      btn.setButtonText(m.modal_cancel()).onClick(() => this.close()),
    );
    if (manifest.counts.actionable > 0) {
      footer.addButton((btn) =>
        btn
          .setButtonText(this.#options.text.confirmButton)
          .setCta()
          .onClick(() => void this.#run()),
      );
    }
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
      this.#options.text.loadingLabel,
      // No width transition: classification can finish faster than the 200ms
      // ease, leaving the bar mid-animation when the confirm phase replaces it
      // while the count already reads 100%.
      false,
    );
    this.#countEl = headline.createDiv({
      cls: "zt:text-sm zt:tabular-nums zt:text-(--text-muted)",
    });
    this.#setBar(0, this.#options.total);
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
      this.#options.text.progressLabel,
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
    warning.createSpan({
      text:
        this.#options.text.progressWarning ?? m.batch_update_progress_warning(),
    });

    this.#renderFailedPanel(shell);
    this.#manifestOrThrow.renderList(this.#renderDisclosure(shell, false));

    new Setting(shell).addButton((btn) =>
      btn.setButtonText(m.modal_cancel()).onClick(() => {
        this.#runAbort?.abort();
        btn
          .setButtonText(
            this.#options.text.cancelling ?? m.batch_update_cancelling(),
          )
          .setDisabled(true);
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
  #addFailure(failure: BatchFailure): void {
    this.#failures.push(failure);
    if (!this.#failedPanel || !this.#failedPanelList) return;
    failureRow(this.#failedPanelList, failure);
    this.#failedPanel.toggle(true);
    this.#failedPanelSummary?.setText(
      (this.#options.text.failedHeader ?? m.batch_update_group_failed)({
        count: this.#failures.length,
      }),
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
   * A `flex-1` scroll region behind a "Show/Hide details" disclosure; the
   * summary text tracks the open state. Returns the `<details>` to fill.
   */
  #renderDisclosure(parent: HTMLElement, open: boolean): HTMLElement {
    const details = parent.createEl("details", {
      cls: "zt:flex-1 zt:min-h-0 zt:overflow-y-auto",
      attr: open ? { open: "" } : {},
    });
    const showText =
      this.#options.text.detailsShow ?? m.batch_update_details_show();
    const hideText =
      this.#options.text.detailsHide ?? m.batch_update_details_hide();
    const summary = details.createEl("summary", {
      cls: "zt:cursor-pointer zt:text-sm zt:text-(--text-muted) zt:py-1",
      text: open ? hideText : showText,
    });
    details.addEventListener("toggle", () => {
      summary.setText(details.open ? hideText : showText);
    });
    return details;
  }

  /** Drive the determinate bar + count line shared by the loading and run phases. */
  #setBar(done: number, total: number): void {
    const pct = total === 0 ? 100 : Math.round((done / total) * 100);
    if (this.#barFill) this.#barFill.style.width = `${pct}%`;
    this.#countEl?.setText(
      (this.#options.text.progressCount ?? m.batch_update_progress_count)({
        done,
        total,
        pct,
      }),
    );
  }

  #updateProgress(): void {
    const total = this.#manifestOrThrow.counts.actionable;
    const failed = this.#failures.length;
    this.#setBar(this.#finalStatus.size, total);
    if (this.#failedEl) {
      this.#failedEl.toggle(failed > 0);
      if (failed > 0) {
        this.#failedEl.setText(
          (this.#options.text.progressFailed ?? m.batch_update_progress_failed)(
            { count: failed },
          ),
        );
      }
    }
  }

  async #run(): Promise<void> {
    this.#renderProgress();
    const abort = new AbortController();
    this.#runAbort = abort;

    let result: BatchRunResult;
    try {
      result = await this.#options.onRun({
        onItemSettled: (event) => {
          this.#finalStatus.set(event.id, event.status);
          this.#manifestOrThrow.setRowStatus(event.id, event.status);
          if (event.status === "failed") this.#addFailure(event.failure);
          this.#updateProgress();
        },
        signal: abort.signal,
      });
    } catch (error) {
      if (!this.#dismissed) {
        const { runFailed } = this.#options.text;
        new BaseNotice(
          typeof runFailed === "function" ? runFailed(error) : runFailed,
        );
        this.close();
      }
      return;
    } finally {
      this.#runAbort = null;
    }

    if (this.#dismissed) {
      new BaseNotice(
        this.#options.text.runSummary(result, {
          cancelled: result.cancelled,
          aborted: true,
        }),
      );
      return;
    }

    const summary = this.#options.text.runSummary(result, {
      cancelled: result.cancelled,
      aborted: false,
    });
    new BaseNotice(summary);
    this.#renderSummary(summary);
  }

  /** Summary line above the manifest's outcome-grouped listing. The disclosure
   * auto-opens only when there were failures. */
  #renderSummary(summary: string): void {
    // The progress-phase DOM (its row icons and live failed panel) is gone after
    // #renderShell; release the detached element references.
    this.#failedPanel = null;
    this.#failedPanelSummary = null;
    this.#failedPanelList = null;
    const shell = this.#renderShell();
    shell.createEl("p", {
      text: summary,
      cls: "zt:shrink-0 zt:mb-1 zt:text-base zt:text-(--text-normal)",
    });

    const details = this.#renderDisclosure(shell, this.#failures.length > 0);
    if (this.#failures.length > 0) {
      const ul = section(
        details,
        (this.#options.text.failedHeader ?? m.batch_update_group_failed)({
          count: this.#failures.length,
        }),
        true,
      );
      for (const failure of this.#failures) failureRow(ul, failure);
    }
    this.#manifestOrThrow.renderSummary(details, this.#finalStatus);

    new Setting(shell).addButton((btn) =>
      btn
        .setButtonText(this.#options.text.closeButton ?? m.batch_update_close())
        .setCta()
        .onClick(() => this.close()),
    );
  }
}
