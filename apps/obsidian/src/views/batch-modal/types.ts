// Contracts shared between the batch-modal shell and its pluggable bodies.

// The classify/run contract is owned by the batch-run service (the leaf that
// drives it); re-exported here so modal code keeps a single import surface.
import {
  type BatchClassifyControls,
  type BatchRunControls,
  type BatchRunResult,
} from "@/services/batch-run";

export type {
  BatchClassifyControls,
  BatchFailure,
  BatchRunControls,
  BatchRunResult,
} from "@/services/batch-run";

/** Counts the manifest exposes so the shell can phrase its phase copy. */
export interface BatchCounts {
  /** Rows that will run (create/overwrite/update). Drives whether the confirm
   * phase offers a run button or an empty state. */
  actionable: number;
  /** Rows resolved to nothing actionable (e.g. ids not in Zotero). */
  notFound: number;
}

/**
 * The variable body of a batch modal. The shell owns the loading → confirm →
 * progress → summary lifecycle, the bar, the buttons, and the live failures
 * panel; the manifest owns the item listing (flat checklist or hierarchy tree),
 * the per-row status icons, and the outcome-grouped summary.
 */
export interface BatchManifest {
  readonly counts: BatchCounts;
  /**
   * Render the full item listing into `parent`. Called once per phase that
   * shows the list (confirm body, then the progress disclosure), rebuilding the
   * row-icon registry each time since the prior phase's DOM was discarded.
   */
  renderList(parent: HTMLElement): void;
  /** Flip a row's terminal status in place; no-op if the row isn't mounted. */
  setRowStatus(id: number, status: "done" | "skipped" | "failed"): void;
  /**
   * Render the outcome-grouped summary into `parent`. `finalStatus` carries the
   * terminal state of every row that ran; absent ids were aborted before
   * running.
   */
  renderSummary(
    parent: HTMLElement,
    finalStatus: ReadonlyMap<number, "done" | "skipped" | "failed">,
  ): void;
}

/**
 * Operation-specific copy the shell renders around the manifest body.
 *
 * Required fields are unique per operation (title, confirm wording, etc.).
 * Optional fields default to shared generic strings when omitted; override
 * them when the default wording is wrong for the operation (e.g. import
 * modals overriding the progress warning).
 */
export interface BatchModalText {
  title: string;
  /** Loading-phase headline over the determinate classify bar. */
  loadingLabel: string;
  /** Notice shown when classification fails (not on cancel/dismiss). */
  loadFailed: string;
  /** Notice shown when the run phase throws before or during execution. */
  runFailed: string;
  /** Run-phase headline over the determinate progress bar. */
  progressLabel: string;
  /** Confirm-phase intro line; receives the manifest's counts. */
  confirmIntro: (counts: BatchCounts) => string;
  /** Confirm-phase CTA. */
  confirmButton: string;
  /** Terminal summary line, also surfaced as a notice. `cancelled` is set when
   * the run was aborted with work still queued; `aborted` when the window was
   * dismissed mid-run. */
  runSummary: (
    result: BatchRunResult,
    state: { cancelled: boolean; aborted: boolean },
  ) => string;

  /** @default "Keep this dialog open until the operation finishes." */
  progressWarning?: string;
  /** @default "{done} / {total} · {pct}%" */
  progressCount?: (args: {
    done: number;
    total: number;
    pct: number;
  }) => string;
  /** @default "{count} failed" */
  progressFailed?: (args: { count: number }) => string;
  /** @default "Show details" */
  detailsShow?: string;
  /** @default "Hide details" */
  detailsHide?: string;
  /** @default "Canceling…" */
  cancelling?: string;
  /** @default "Failed ({count})" */
  failedHeader?: (args: { count: number }) => string;
  /** @default "Close" */
  closeButton?: string;
}

export interface BatchModalOptions {
  text: BatchModalText;
  /** Total ids being classified, for the loading-phase progress bar. */
  total: number;
  /**
   * Loading phase: resolve the ids into the manifest the confirm/progress/
   * summary phases render. Runs behind the determinate bar, reporting progress
   * and honoring the abort signal.
   */
  onClassify: (controls: BatchClassifyControls) => Promise<BatchManifest>;
  onRun: (controls: BatchRunControls) => Promise<BatchRunResult>;
}
