// Contracts shared between the batch-modal shell and its pluggable bodies.
import { type BatchFailure } from "./dom";

export type { BatchFailure };

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

/** Operation-specific copy the shell renders around the manifest body. */
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
}

export interface BatchClassifyControls {
  /** Reports how many ids have been classified, driving the loading bar against
   * the total passed at construction. */
  onProgress: (classified: number) => void;
  signal: AbortSignal;
}

export interface BatchRunControls {
  /** Reports a single row reaching a terminal state. The shell owns the running
   * counts and flips the row in place; aborted queued work never settles. */
  onItemSettled: (
    event:
      | { id: number; status: "done" }
      | { id: number; status: "skipped" }
      | { id: number; status: "failed"; failure: BatchFailure },
  ) => void;
  signal: AbortSignal;
}

export interface BatchRunResult {
  created: number;
  updated: number;
  /** Rows that settled without writing (e.g. an import whose file already
   * existed). `0` for operations with no skip path, like batch update. */
  skipped: number;
  failed: number;
  cancelled: boolean;
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
