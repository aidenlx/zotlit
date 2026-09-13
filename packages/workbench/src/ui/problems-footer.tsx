// The editor's Problems area: one detected problem at a time, led by the
// object it is about, and the disclosure the reader controls. Automatic checks
// leave that choice alone; Show problem, a source marker, and a failed
// explicit Run open it. Its controls navigate, disclose, and report — every
// repair is the reader's own edit, described in the suggestion.
//
// Several problems are counted and offered in a selector, and the selected one
// is the one that stays through a check. A repair that resolves it while
// others remain says so and offers Next problem, so the explanation the reader
// is on changes when the reader asks and not when a check lands.
//
// Technical details shows the report text, and Copy error report copies that
// same text. The report was captured with its attempt, so it keeps describing
// that failure after the reader edits the source, chooses another Item, or
// repairs the template; a resolved area still offers the last one. A document
// problem reaches the reader through the same report: the scheduler stamps a
// render failure with its attempt, and this area stamps a parser problem with
// the check that found it.
//
// Source and explanation share the pane. The divider adjusts that share;
// the chevron closes the explanation and returns focus to the source.

import type { RenderReport, WorkbenchReportContext } from "#/render/report";
import type { RenderDiagnostic, TemplateRenderResult } from "#/render/result";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { WorkbenchMessages } from "./generated/messages";
import { useOptionalHost } from "./host";
import { useWorkbenchMessages } from "./messages";
import type { WorkbenchDiagnosis } from "./problems";
import {
  diagnosisEngineSources,
  diagnosisExplanation,
  diagnosisLabel,
  diagnosisLocated,
  diagnosisReport,
  diagnosisWhere,
  problemText,
  renderDiagnosis,
} from "./problems";
import type { RenderTrigger } from "./scheduler";
import { WorkbenchOption, WorkbenchSelect } from "./select";
import { useParts, useIcon } from "./theme";

import { captureProblemReport, formatRenderReport } from "#/render/report";

export { problemWhere } from "./problems";

/** The Problems area's own state: which problem is read, and whether in full. */
export interface WorkbenchProblemsState {
  readonly diagnoses: readonly WorkbenchDiagnosis[];
  /** The problem the area explains; `null` once the selected one is resolved. */
  readonly selected: WorkbenchDiagnosis | null;
  /**
   * The problem the reader is reading, whether or not this check still finds
   * it, so a resolved explanation can still name what it was about.
   */
  readonly inspected: WorkbenchDiagnosis | null;
  /** The reader's own open-or-collapsed choice, which checks never change. */
  readonly open: boolean;
  /**
   * The selected problem's captured report, or the last one read once that
   * problem is resolved. Bounded to what is being inspected: one repair does
   * not build a history, and a later problem brings its own report.
   */
  readonly report: RenderReport | null;
  /** Whether `report` describes a failure this check no longer finds. */
  readonly resolved: boolean;
  /**
   * The problem to read once the selected one is resolved and others remain;
   * `null` while the selected problem stands and once nothing is left. Only
   * the reader moves the explanation on, so a check never selects it.
   */
  readonly next: WorkbenchDiagnosis | null;
  /** Reads one problem in full, which a source marker and Show problem do. */
  readonly select: (id: string) => void;
  /** Opens or reclaims the area; reclaiming it also gives back the editor. */
  readonly setOpen: (open: boolean) => void;
}

/**
 * What a document problem's own report is captured from. The parser reads
 * those problems out of the current source on every check, so the attempt
 * behind one is the check that found it: its own wording, the source it was
 * read from, and what names this Workbench. A host that supplies none leaves
 * its document problems without a report.
 */
export interface WorkbenchProblemCapture {
  readonly messages: WorkbenchMessages;
  /** The document text the checks read. */
  readonly source: string;
  readonly context: () => WorkbenchReportContext;
}

export function useWorkbenchProblems({
  diagnoses,
  trigger,
  attempt,
  capture,
}: {
  readonly diagnoses: readonly WorkbenchDiagnosis[];
  /** How the attempt behind the newest result started. */
  readonly trigger: RenderTrigger | null;
  /** Counts published results, so one deliberate failure opens the area once. */
  readonly attempt: number;
  readonly capture?: WorkbenchProblemCapture;
}): WorkbenchProblemsState {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Reclaiming the area hands the editor back whole, so the next Show problem
  // starts from the split rather than from the space the last reading took.
  // The reading is over with it: a compact area follows the first problem
  // found, so a repair that resolves the problem the reader had open leaves
  // the summary on whatever is still there rather than on nothing at all.
  // One identity for the life of the hook: a host subscribes with this.
  const openArea = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setSelectedId(null);
    }
  }, []);
  // Selection keys on the problem's identity rather than its place in the
  // list, so a check that finds the same problem keeps the reader's place.
  // An open area holds the problem being read from the moment it is read: its
  // repair is then a resolved explanation rather than a silent move to the
  // next problem. A compact area reads whichever problem comes first, and a
  // check that finds nothing lets the selection go, so the next failure
  // arrives as the problem it is.
  const first = diagnoses[0] ?? null;
  const selected =
    selectedId === null
      ? first
      : (diagnoses.find(({ id }) => id === selectedId) ?? null);
  useEffect(() => {
    if (first === null) setSelectedId(null);
    else if (open) setSelectedId((kept) => kept ?? first.id);
  }, [first, open]);
  const opened = useRef(attempt);
  const failed = diagnoses.length > 0;
  useEffect(() => {
    if (attempt === opened.current) return;
    opened.current = attempt;
    // A deliberate attempt that failed is the reader asking what happened; an
    // automatic one during typing leaves the area as they left it.
    if (trigger === "explicit" && failed) setOpen(true);
  }, [attempt, trigger, failed]);
  // A document problem is found again by every check, so its report is taken
  // the first time that problem is seen and held while it lasts: a later edit,
  // another Item, or another check leaves the captured one as it stands. A
  // problem the checks stop finding takes its report with it, which is what
  // keeps this inspection bounded rather than a failure history.
  // The web host's existing ensureTemporal effect causes a later render after
  // installing its polyfill, so an early invalid draft remains uncaptured here.
  const documentReports = useRef(new Map<string, RenderReport>());
  const held = new Map<string, RenderReport>();
  const temporal = globalThis.Temporal;
  for (const diagnosis of diagnoses) {
    if (diagnosis.kind !== "document" || capture === undefined) continue;
    const kept = documentReports.current.get(diagnosis.id);
    if (kept !== undefined) {
      held.set(diagnosis.id, kept);
      continue;
    }
    if (temporal === undefined) continue;
    held.set(
      diagnosis.id,
      captureProblemReport({
        problem: diagnosis.problem,
        message: problemText(capture.messages, diagnosis.problem).message,
        source: capture.source,
        capturedAt: temporal.Now.instant().toString(),
        context: capture.context(),
      }),
    );
  }
  documentReports.current = held;
  // The report the reader is looking at survives the repair that resolves it,
  // so a successful check still leaves the failure they wanted to report. It
  // resurfaces only once nothing is selected: another problem's explanation
  // shows that problem's own evidence, never the last engine failure.
  const current =
    selected === null
      ? null
      : (diagnosisReport(selected) ??
        documentReports.current.get(selected.id) ??
        null);
  const [inspected, setInspected] = useState<RenderReport | null>(null);
  useEffect(() => {
    if (current !== null) setInspected(current);
  }, [current]);
  // The problem the reader is reading, kept past the repair that resolves it
  // so the area can still name what the resolved explanation was about. A
  // cache of what this render already computed, not state of its own.
  const reading = useRef<WorkbenchDiagnosis | null>(null);
  if (selected !== null) reading.current = selected;
  return {
    diagnoses,
    selected,
    inspected: selected ?? reading.current,
    open,
    report: current ?? (selected === null ? inspected : null),
    resolved: current === null,
    // Offered rather than taken: a check that resolves the selected problem
    // leaves the reader on its resolved state until they ask for the next one.
    next: selected === null ? first : null,
    select(id) {
      setSelectedId(id);
      setOpen(true);
    },
    setOpen: openArea,
  };
}

/** Nothing found, as one value, so an idle preview publishes no new list. */
const NO_DIAGNOSTICS: readonly RenderDiagnostic[] = [];

/**
 * The preview's half of the Problems contract, which both hosts keep alike:
 * what this preview's render found goes to the editor that explains it, a
 * preview that closes takes its findings back with it, and a deliberate Run
 * that failed asks for its explanation at once. A failure while the reader
 * types asks for nothing, which is what leaves the editor as they left it.
 *
 * `publish` and `showProblem` are read through refs, so a host may pass a
 * fresh callback on every draw without republishing on every draw.
 */
export function usePublishedProblems({
  result,
  trigger,
  attempt,
  publish,
  showProblem,
}: {
  /** The newest landed result, whose diagnostics this preview publishes. */
  readonly result: TemplateRenderResult | null;
  /** How the attempt behind that result started. */
  readonly trigger: RenderTrigger | null;
  /** Counts published results, so one deliberate failure opens the area once. */
  readonly attempt: number;
  readonly publish: (diagnostics: readonly RenderDiagnostic[]) => void;
  readonly showProblem: (id: string, occurrence?: RenderDiagnostic) => void;
}): void {
  const diagnostics = result?.diagnostics ?? NO_DIAGNOSTICS;
  const publishing = useRef(publish);
  publishing.current = publish;
  const open = useRef(showProblem);
  open.current = showProblem;
  useEffect(() => {
    publishing.current(diagnostics);
  }, [diagnostics]);
  useEffect(() => () => publishing.current(NO_DIAGNOSTICS), []);
  const opened = useRef(attempt);
  useEffect(() => {
    if (attempt === opened.current) return;
    opened.current = attempt;
    const first = diagnostics[0];
    if (trigger === "explicit" && first)
      open.current(renderDiagnosis(first).id, first);
  }, [attempt, trigger, diagnostics]);
}

export function ProblemsFooter({
  problems,
  onOpen,
  onReturn,
}: {
  /** The area's state, from `useWorkbenchProblems`. */
  problems: WorkbenchProblemsState;
  /** Opens the pane the selected problem is repaired in. */
  onOpen: (diagnosis: WorkbenchDiagnosis) => void;
  /**
   * Puts the reader back where they were editing, which the area asks for once
   * it has reclaimed its space. A host that supplies none leaves the source
   * where the reading left it.
   */
  onReturn?: () => void;
}) {
  const m = useWorkbenchMessages();
  const host = useOptionalHost();
  const part = useParts("problemsFooter");
  const icon = useIcon();
  const panel = useRef<HTMLElement>(null);
  const [size, setSize] = useState(55);
  const drag = useRef<{ y: number; size: number; height: number } | null>(null);
  const headingId = useId();
  const bodyId = useId();
  const {
    diagnoses,
    selected,
    inspected,
    next,
    open,
    setOpen,
    report,
    resolved,
  } = problems;
  const select = problems.select;
  const scroll = useRef<HTMLDivElement | null>(null);
  const focusReadingAfterCommit = useRef(false);
  useLayoutEffect(() => {
    if (!focusReadingAfterCommit.current) return;
    focusReadingAfterCommit.current = false;
    scroll.current?.focus();
  }, [open, selected?.id]);
  /** Focus the stable explanation region after its trigger disappears. */
  function focusReading(): void {
    focusReadingAfterCommit.current = true;
    scroll.current?.focus();
  }
  /** Reading is over: the source takes its space back and the caret with it. */
  function returnToTemplate(): void {
    setOpen(false);
    onReturn?.();
  }
  function toggleOpen(): void {
    if (open) returnToTemplate();
    else setOpen(true);
  }
  // One text, shown and copied. Building it once keeps Technical details and
  // the clipboard from ever disagreeing about what was reported.
  const reportText = useMemo(
    () => (report === null ? null : formatRenderReport(report)),
    [report],
  );
  const details = useRef<HTMLDetailsElement | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  // A different report is a different copy: the previous failure notice goes.
  useEffect(() => setCopyFailed(false), [reportText]);
  const copyable = host?.copy !== undefined;
  function copyReport(text: string): void {
    if (host?.copy === undefined) return;
    setCopyFailed(false);
    void host.copy(text).then(
      () => host.notice(m.workbench_problems_copy_done()),
      () => {
        // A denied clipboard leaves the reader the report itself: the
        // disclosure opens so the text is there to select and copy by hand.
        setCopyFailed(true);
        if (details.current) details.current.open = true;
      },
    );
  }
  /** Technical details, Copy error report, and Ask the community, as one block. */
  function reporting(text: string | null, evidence: string | null) {
    return (
      <>
        <details ref={details} {...part("problems-details")}>
          <summary {...part("problems-details-label")}>
            {m.workbench_problems_technical()}
          </summary>
          {text === null ? (
            <p {...part("problems-evidence")}>
              {evidence ?? m.workbench_problems_evidence_none()}
            </p>
          ) : (
            <pre {...part("problems-report")}>{text}</pre>
          )}
        </details>
        {copyFailed && (
          <p role="alert" {...part("problems-copy-failed")}>
            {m.workbench_problems_copy_failed()}
          </p>
        )}
      </>
    );
  }
  /** The reporting controls, which stay reachable while the details collapse. */
  function reportControls(text: string | null) {
    return (
      <>
        {text !== null && copyable && (
          <button
            type="button"
            onClick={() => copyReport(text)}
            {...part("problems-copy")}
          >
            {resolved
              ? m.workbench_problems_copy_last()
              : m.workbench_problems_copy()}
          </button>
        )}
        {host?.communityUrl !== undefined && (
          <a
            href={host.communityUrl}
            target="_blank"
            rel="noreferrer"
            {...part("problems-community")}
          >
            {m.workbench_problems_community()}
          </a>
        )}
      </>
    );
  }
  // Nothing found and nothing open: the area gives its space back to the
  // source rather than reporting its own emptiness.
  if (selected === null && !open) return null;
  const explanation = selected && diagnosisExplanation(m, selected);
  const engineSources = selected ? diagnosisEngineSources(m, selected) : [];
  // Several problems are chosen between rather than read at once, and the
  // choice names the object each one is about, so it stands in for the line
  // the explanation would otherwise lead with.
  const several = diagnoses.length > 1;
  return (
    <section
      ref={panel}
      style={open ? { flex: `0 0 ${size}%` } : undefined}
      data-error={diagnoses.length > 0 || undefined}
      aria-labelledby={headingId}
      // The reader's chosen share survives checks, repairs, and reopening.
      {...part("problems", open ? "open" : "compact")}
    >
      {open && (
        <div
          role="separator"
          tabIndex={0}
          aria-label={m.workbench_problems_heading()}
          aria-orientation="horizontal"
          aria-valuemin={20}
          aria-valuemax={85}
          aria-valuenow={Math.round(size)}
          aria-controls={selected || reportText || next ? bodyId : undefined}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const height =
              panel.current!.parentElement!.getBoundingClientRect().height;
            drag.current = { y: event.clientY, size, height };
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (start)
              setSize(
                Math.max(
                  20,
                  Math.min(
                    85,
                    start.size +
                      ((start.y - event.clientY) / start.height) * 100,
                  ),
                ),
              );
          }}
          onPointerUp={(event) => {
            drag.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowUp"
                ? size + 5
                : event.key === "ArrowDown"
                  ? size - 5
                  : event.key === "Home"
                    ? 20
                    : event.key === "End"
                      ? 85
                      : null;
            if (next === null) return;
            event.preventDefault();
            setSize(Math.max(20, Math.min(85, next)));
          }}
          {...part("problems-resize")}
        />
      )}
      <div {...part("problems-summary")}>
        {diagnoses.length > 0 && (
          <span {...part("problems-error-icon")}>{icon("error")}</span>
        )}
        <p id={headingId} {...part("problems-heading")}>
          {m.workbench_problems_heading()}
        </p>
        {/* What the checks found, never what the document holds: a parser that
            stops at its first error leaves the rest undiscovered. */}
        {diagnoses.length === 0 ? (
          <p {...part("problems-text")}>{m.workbench_problems_none()}</p>
        ) : (
          <p
            role="status"
            aria-label={m.workbench_problems_count({ count: diagnoses.length })}
            {...part("problems-count")}
          >
            {diagnoses.length}
          </p>
        )}
        {!open && explanation !== null && (
          <p {...part("problems-text")}>{explanation.condition}</p>
        )}
        {/* How much of the editor this reading takes, on the trailing edge and
            together: one grows the area, the other gives it all back. */}
        <div {...part("problems-space")}>
          <button
            type="button"
            aria-label={
              open ? m.workbench_problems_return() : m.workbench_problem_show()
            }
            title={
              open ? m.workbench_problems_return() : m.workbench_problem_show()
            }
            aria-expanded={open}
            aria-controls={open ? bodyId : undefined}
            onClick={toggleOpen}
            {...part("problems-toggle")}
          >
            {icon(open ? "chevron-down" : "chevron-up")}
          </button>
        </div>
      </div>
      {open && selected && explanation && (
        <div id={bodyId} {...part("problems-body")}>
          {/* The explanation is what scrolls. A reader with no pointer scrolls
              it from here, and the controls below stay where they were. */}
          <div ref={scroll} tabIndex={0} {...part("problems-scroll")}>
            {several ? (
              <div {...part("problems-select")}>
                <WorkbenchSelect
                  aria-label={m.workbench_problems_selected()}
                  value={selected.id}
                  onInput={(event) => select(event.currentTarget.value)}
                >
                  {diagnoses.map((diagnosis) => (
                    <WorkbenchOption key={diagnosis.id} value={diagnosis.id}>
                      {diagnosisLabel(m, diagnosis)}
                    </WorkbenchOption>
                  ))}
                </WorkbenchSelect>
              </div>
            ) : (
              <p {...part("problems-object")}>{explanation.object}</p>
            )}
            <p {...part("problems-text")}>{explanation.condition}</p>
            <p {...part("problems-recovery")}>{explanation.suggestion}</p>
            {/* Where the engine said it happened and where the reader repairs
                it are different places, so they are read as separate lines
                rather than folded into one claim. Grouped occurrences each keep
                the place they were reported from. */}
            {engineSources.map((sentence) => (
              <p key={sentence} {...part("problems-location")}>
                {sentence}
              </p>
            ))}
            {!diagnosisLocated(selected) && (
              <p {...part("problems-location")}>
                {m.workbench_problems_location_unknown()}
              </p>
            )}
            {reporting(reportText, explanation.evidence ?? null)}
          </div>
          <div {...part("problems-controls")}>
            <button
              type="button"
              onClick={() => {
                // The reading gives the pane back before the caret moves:
                // an explanation holding the whole editor would otherwise
                // send the reader to source it hides.
                setOpen(false);
                onOpen(selected);
              }}
              {...part("problems-open")}
            >
              {diagnosisWhere(m, selected)}
            </button>
            {reportControls(reportText)}
          </div>
        </div>
      )}
      {open &&
        selected === null &&
        (reportText !== null || (next !== null && inspected !== null)) && (
          // The repair succeeded, and the failure the reader was reading is
          // still here to report. It is the last one inspected, not a history.
          <div id={bodyId} {...part("problems-body")}>
            <div ref={scroll} tabIndex={0} {...part("problems-scroll")}>
              {next !== null &&
                inspected !== null && (
                  // Others were found, so this says which one went rather than
                  // presenting the whole preview as successful.
                  <>
                    <p {...part("problems-object")}>
                      {diagnosisLabel(m, inspected)}
                    </p>
                    <p {...part("problems-text")}>
                      {m.workbench_problems_resolved()}
                    </p>
                  </>
                )}
              {reportText !== null && reporting(reportText, null)}
            </div>
            <div {...part("problems-controls")}>
              {next !== null && (
                <button
                  type="button"
                  onClick={() => {
                    focusReading();
                    select(next.id);
                  }}
                  {...part("problems-next")}
                >
                  {m.workbench_problems_next()}
                </button>
              )}
              {reportControls(reportText)}
            </div>
          </div>
        )}
    </section>
  );
}
