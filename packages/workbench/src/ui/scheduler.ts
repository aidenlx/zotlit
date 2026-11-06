import type { WorkbenchRunner } from "#/language/host-effects";
// A view-owned scheduler consumes values and interrupts work for superseded inputs.
import type { CitationPreviewSelection } from "#/render/citation-examples";
import type { PartialPreviewSelection } from "#/render/partial-preview";
import type { WorkbenchReportContext } from "#/render/report";
import type { RenderRequest, RenderResources } from "#/render/request";
import type {
  TemplateRenderResult,
  RenderDiagnostic,
  RenderedProperty,
  RenderIdentity,
} from "#/render/result";
import type { AnnotationExample } from "#/render/sample-annotations";
import type { ItemSnapshot } from "#/snapshot/index";
import type { Effect } from "effect";

import { WorkbenchHostError } from "./host";
import { forkReported } from "./run";
import type { PreviewMode } from "./store";

import { followEntries } from "#/document/manifest-patch";
import { captureRenderReport, engineEvidence } from "#/render/report";
import {
  failedRender,
  renderFailed,
  retainOutputs,
  templateSourceRevision,
  renderIdentity,
} from "#/render/result";

export interface RenderSchedulerInput {
  readonly source: string;
  /**
   * The Template Document this preview reads — a vault path or a draft
   * reference. Output kept from another document is another preview's, so a
   * scheduler that follows the reader from one document to the next names the
   * one it is on. A host with one document all along leaves it out.
   */
  readonly document?: string;
  readonly mode: PreviewMode;
  readonly live: boolean;
  /** The paper a render is shown against; `null` while the host loads one. */
  readonly snapshot: ItemSnapshot | null;
  readonly annotation?: AnnotationExample | null;
  /**
   * The Citation set and Variant a Citation Template render reads. A new object
   * per choice, so a reader's pick of another example or variant is a new input.
   */
  readonly citation?: CitationPreviewSelection | null;
  /**
   * The context and Profile a Shared Partial render reads. A new object per
   * choice, so the reader's pick of another caller is a new input.
   */
  readonly partial?: PartialPreviewSelection | null;
  readonly resources?: RenderResources;
  /**
   * Holds rendering while the host cannot answer for this draft — a Profile it
   * refuses, or a dependency bundle read for another one. Unlike Stop, a render
   * in flight is dropped, and the result still shown reads as stale.
   *
   * `"invalid"` names the one hold that is a failure rather than a wait: a
   * document the parser refuses. The preview reads it the way it reads a
   * render that failed, and names the output it kept.
   */
  readonly hold?: boolean | "invalid";
}

/**
 * How an attempt started. Run and the quiet time after an edit reach the same
 * entry point, so the result names which one asked for it: a deliberate
 * failure deserves an explanation at once, a failure while typing does not.
 */
export type RenderTrigger = "explicit" | "automatic";

export interface RenderSchedulerState<
  R extends TemplateRenderResult = TemplateRenderResult,
> {
  readonly result: R | null;
  /**
   * The newest output each preview surface produced, kept while `result` is a
   * failed attempt the reader can still compare against it. A note that failed
   * beside an annotation that rendered keeps the last note that worked. Null
   * once the retained output describes a document, paper, example, caller, or
   * mode the reader has left, which is what keeps another preview's result out
   * of this one.
   */
  readonly retained: R | null;
  /** Set from the moment a render starts until its result lands or is dropped. */
  readonly busy: boolean;
  /**
   * Why `result` describes a draft, paper, or mode the reader has left, or why
   * none exists yet; `null` while the shown result is current. `live` means a
   * render of the new input is on its way, so the result stands until it
   * lands; `demand` waits for Run; `hold` and `invalid` wait for a repair.
   */
  readonly staleReason: "hold" | "invalid" | "demand" | "live" | null;
  /** How the attempt behind `result` started; `null` while none has landed. */
  readonly trigger: RenderTrigger | null;
  /**
   * Counts the results this scheduler has published. Two attempts over the
   * same bytes are still two attempts, which is what tells a reader's second
   * deliberate failure from the first.
   */
  readonly attempt: number;
}

export interface RenderSchedulerOptions<R extends TemplateRenderResult> {
  /**
   * Renders one request. A template failure is part of the result; the error
   * channel holds a host failure, which the scheduler shows as a failed
   * attempt.
   */
  readonly render: (
    request: RenderRequest,
  ) => Effect.Effect<R, WorkbenchHostError>;
  /** Forks each render; a superseded render is interrupted. */
  readonly run: WorkbenchRunner;
  /**
   * The host's own shape for a result this scheduler composed itself, so a
   * failure reads like every other result the host publishes.
   */
  readonly failed: (result: TemplateRenderResult) => R;
  /** Retain outputs together with the host metadata that describes them. */
  readonly retain?: (kept: R, result: R) => R;
  readonly input: RenderSchedulerInput;
  /**
   * What names this Workbench in the report a failed attempt is copied as,
   * read once per landed result. A scheduler with none reports those fields
   * unavailable.
   */
  readonly reportContext?: () => WorkbenchReportContext;
  /** Quiet time after the last edit before a render starts. @default 300 */
  readonly debounceMs?: number;
}

export interface RenderScheduler<
  R extends TemplateRenderResult = TemplateRenderResult,
> extends Disposable {
  readonly getState: () => RenderSchedulerState<R>;
  readonly subscribe: (listener: () => void) => () => void;
  /** What the host supplies for every render from here on. */
  setInput(input: Partial<RenderSchedulerInput>): void;
  /** Something a render reads changed outside the document. */
  invalidate(): void;
  /** Run: renders now, whatever the refresh setting says. */
  run(): void;
  /** Stop: no new render starts; one already running finishes. */
  pause(): void;
  /** Shows `diagnostic` where the host could not supply what a render reads. */
  fail(diagnostic: RenderDiagnostic): void;
}

/** Why the shown result is stale; `current` says it matches the input. */
function staleReasonFor(
  input: Pick<RenderSchedulerInput, "hold" | "live">,
  current: boolean,
): RenderSchedulerState["staleReason"] {
  if (input.hold === "invalid") return "invalid";
  if (input.hold === true) return "hold";
  if (current) return null;
  return input.live ? "live" : "demand";
}

/**
 * `result` as read against `to`. Output names Managed Frontmatter entries by
 * their position in the draft it was rendered from, and a result stands across
 * an edit until the next render lands, so each position is moved to the entry
 * it belongs to in the current draft. A value of an entry the edit removed is
 * dropped, and its problem names no row. The attempt itself — its source
 * revision and its reports — is unchanged, and so is the result when nothing
 * moved.
 */
function rebased<R extends TemplateRenderResult>(
  result: R,
  from: string,
  to: string,
): R {
  if (
    from === to ||
    (result.properties.length === 0 &&
      result.fold.length === 0 &&
      result.diagnostics.every(({ position }) => position === undefined))
  )
    return result;
  const follow = followEntries(from, to);
  if (follow === null) return result;
  const move = (list: readonly RenderedProperty[]) =>
    list.flatMap((property) => {
      const position = follow(property.position);
      return position === undefined ? [] : [{ ...property, position }];
    });
  return {
    ...result,
    properties: move(result.properties),
    fold: move(result.fold),
    // A removed entry's problem still explains why the attempt produced what
    // it did, so it stays, naming no row.
    diagnostics: result.diagnostics.map((diagnostic) => {
      if (diagnostic.position === undefined) return diagnostic;
      const { position: _removed, ...unplaced } = diagnostic;
      const position = follow(diagnostic.position);
      return position === undefined ? unplaced : { ...diagnostic, position };
    }),
  };
}

/**
 * {@link rebased}, answering with the same object while the result and the
 * draft it is read against stay the same, so a publish with nothing new
 * notifies no one.
 */
function rebaser<R extends TemplateRenderResult>() {
  let last: { result: R; to: string; out: R } | null = null;
  return (result: R | null, from: string, to: string): R | null => {
    if (result === null) return null;
    if (last?.result !== result || last.to !== to)
      last = { result, to, out: rebased(result, from, to) };
    return last.out;
  };
}

/** Whether nothing may render, for either reason a host gives. */
function held(input: Pick<RenderSchedulerInput, "hold">): boolean {
  return input.hold === true || input.hold === "invalid";
}

export function createRenderScheduler<R extends TemplateRenderResult>({
  render,
  run,
  failed,
  retain = retainOutputs,
  input: initial,
  reportContext,
  debounceMs = 300,
}: RenderSchedulerOptions<R>): RenderScheduler<R> {
  let input = initial;
  let state: RenderSchedulerState<R> = {
    result: null,
    retained: null,
    busy: false,
    staleReason: staleReasonFor(initial, false),
    trigger: null,
    attempt: 0,
  };
  // The newest attempt that landed, as rendered, and the draft it rendered.
  // What the reader sees is this result read against the draft they have now.
  let landed: R | null = null;
  let landedSource = initial.source;
  const shownResult = rebaser<R>();
  // The last output each preview surface produced, whatever has failed since,
  // named in the positions of the draft the newest attempt rendered.
  let produced: R | null = null;
  let producedSource = initial.source;
  const shownRetained = rebaser<R>();
  // The Template Document `produced` was rendered from, so output kept for one
  // document is never read against another.
  let producedDocument = initial.document;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let current: RenderIdentity | undefined;
  // Interrupts the render in flight; Stop leaves it running.
  let interruptCurrent: (() => void) | undefined;
  // A host may reach a disposed scheduler from a continuation it started while
  // the view was still open, and a disposed one answers for nothing.
  let closed = false;
  const listeners = new Set<() => void>();
  using cleanup = new DisposableStack();
  cleanup.defer(() => listeners.clear());
  cleanup.defer(abandon);

  /**
   * Whether a result describes the paper, example, caller, and mode the reader
   * is on now. A result already on screen describes the example it was
   * rendered for, so a reader who chooses another one has moved past it. The
   * source is left out: an edit makes a result stale without making it
   * another preview's.
   */
  function sameSelection(result: RenderIdentity): boolean {
    return !(
      (input.snapshot !== null &&
        result.snapshotRevision !== input.snapshot.revision) ||
      (input.annotation != null &&
        (result.annotationId !== input.annotation.id ||
          result.annotationRevision !== input.annotation.revision)) ||
      (input.citation != null &&
        (result.citationVariant !== input.citation.variant ||
          (result.citationExample ?? null) !== input.citation.example)) ||
      (input.partial != null &&
        (result.partialContext !== input.partial.context ||
          (result.partialProfile ?? null) !== input.partial.profile)) ||
      result.previewMode !== input.mode
    );
  }

  /**
   * Pairs each of a landed result's diagnostics with the attempt behind it,
   * once. From here on the report describes that attempt: a later edit,
   * selection, or preview has no way back into it.
   */
  function stamp(result: R, trigger: RenderTrigger, sequence: number): R {
    if (result.diagnostics.every(({ report }) => report !== undefined)) {
      return result;
    }
    const capturedAt = Temporal.Now.instant().toString();
    const context = reportContext?.() ?? {};
    return {
      ...result,
      diagnostics: result.diagnostics.map((diagnostic) =>
        diagnostic.report === undefined
          ? {
              ...diagnostic,
              report: captureRenderReport({
                diagnostic,
                identity: result,
                trigger,
                sequence,
                capturedAt,
                context,
              }),
            }
          : diagnostic,
      ),
    };
  }

  function publish(next: {
    result?: R | null;
    /** The draft `result` was rendered from; the current one when absent. */
    source?: string;
    busy?: boolean;
    trigger?: RenderTrigger;
  }): void {
    if (closed) return;
    const { trigger } = next;
    const isLanding = trigger !== undefined;
    const attempt = isLanding ? state.attempt + 1 : state.attempt;
    if (next.result !== undefined) {
      // Stamped before anything else reads it, so the result the reader keeps
      // comparing against carries the same report the shown one does.
      landed =
        trigger !== undefined && next.result !== null
          ? stamp(next.result, trigger, attempt)
          : next.result;
      landedSource = next.source ?? input.source;
    }
    const result = landed;
    const busy = next.busy ?? state.busy;
    // A Property failure makes the note surface unsuccessful even when the
    // renderer returned its partial body; independent surfaces still land. The
    // note name is one of them: it renders apart from the note, so a failing
    // rule leaves the name this attempt produced.
    const resultForRetention =
      result !== null &&
      result.diagnostics.some(({ code }) => code === "property-error")
        ? ({
            ...result,
            properties: [],
            fold: [],
            frontmatterBlock: null,
            creationBody: null,
            managedRegion: null,
            annotationRanges: [],
          } as R)
        : result;
    // Each surface keeps the newest output it produced, so a note that failed
    // beside an annotation that rendered leaves the last good note standing.
    if (
      isLanding &&
      resultForRetention !== null &&
      !renderFailed(resultForRetention)
    ) {
      produced =
        produced !== null && producedDocument === input.document
          ? retain(
              rebased(produced, producedSource, landedSource),
              resultForRetention,
            )
          : resultForRetention;
      producedDocument = input.document;
      producedSource = landedSource;
    }
    // Only a failure sends the reader back to working output, and only where
    // that output still answers for the document and the selection they are
    // reading now. A document the parser refuses is such a failure: no attempt
    // ever ran.
    const broken =
      input.hold === "invalid" ||
      (result !== null && result.diagnostics.length > 0);
    const retained =
      broken &&
      produced !== null &&
      producedDocument === input.document &&
      sameSelection(produced)
        ? shownRetained(produced, producedSource, input.source)
        : null;
    const identityMismatch =
      result !== null &&
      (result.sourceRevision !== templateSourceRevision(input.source) ||
        !sameSelection(result));
    const staleReason = staleReasonFor(
      input,
      result !== null && !identityMismatch,
    );
    const shown = shownResult(result, landedSource, input.source);
    if (
      !isLanding &&
      shown === state.result &&
      retained === state.retained &&
      busy === state.busy &&
      staleReason === state.staleReason
    ) {
      return;
    }
    state = {
      result: shown,
      retained,
      busy,
      staleReason,
      trigger: trigger ?? state.trigger,
      attempt,
    };
    for (const listener of listeners) listener();
  }

  /** What a render would be asked for now, or `null` while nothing may run. */
  function nextRequest(): RenderRequest | null {
    const { snapshot, annotation, citation, partial, resources } = input;
    if (closed || held(input) || snapshot === null) return null;
    return {
      mode: input.mode,
      source: input.source,
      snapshot,
      ...(annotation ? { annotation } : {}),
      ...(citation ? { citation } : {}),
      ...(partial ? { partial } : {}),
      ...(resources ? { resources } : {}),
    };
  }

  /** Drops queued and running work alike, which Stop deliberately does not. */
  function abandon(): void {
    clearTimeout(pending);
    pending = undefined;
    current = undefined;
    const interrupt = interruptCurrent;
    interruptCurrent = undefined;
    interrupt?.();
  }

  function pause(): void {
    clearTimeout(pending);
    pending = undefined;
  }

  function start(request: RenderRequest, trigger: RenderTrigger): void {
    // The stamp doubles as this start's token: whatever replaces it leaves the
    // render it belonged to answering into a scheduler that has moved on.
    const identity = renderIdentity(request);
    current = identity;
    pending = undefined;
    publish({ busy: true });
    const interrupt = forkReported(run, render(request), {
      onSuccess: (result) => {
        if (current !== identity) return;
        current = undefined;
        interruptCurrent = undefined;
        publish({ result, source: request.source, busy: false, trigger });
      },
      // A template that throws stops this render, not the host around it.
      onFailure: (failure) => {
        if (current !== identity) return;
        current = undefined;
        interruptCurrent = undefined;
        // The host failure carries the engine's error, whole: the message
        // alone loses the name, the chain, and the excerpt a reader needs to
        // report the failure.
        const error =
          failure instanceof WorkbenchHostError ? failure.cause : failure;
        publish({
          result: failed(
            failedRender(identity, {
              code: "render-error",
              message: error instanceof Error ? error.message : String(error),
              evidence: engineEvidence(error),
              part: "render",
            }),
          ),
          source: request.source,
          busy: false,
          trigger,
        });
      },
    });
    // A render that answered before `run` returned has already landed.
    if (current === identity) interruptCurrent = interrupt;
  }

  function changed(): void {
    // A render in flight would answer for a source, paper, example, or mode the
    // reader has moved past, so it is dropped whatever the refresh setting says;
    // only Stop, which leaves the input alone, lets one land.
    abandon();
    const request = nextRequest();
    if (request !== null && input.live) {
      pending = setTimeout(() => start(request, "automatic"), debounceMs);
    }
    publish({ busy: false });
  }

  changed();

  const lifetime = cleanup.move();
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setInput(next) {
      if (closed) return;
      const previous = input;
      input = { ...input, ...next };
      // No paper, nothing to render: whatever is shown describes another one.
      if (input.snapshot === null) {
        abandon();
        publish({ result: null, busy: false });
        return;
      }
      const sameRenderInput =
        input.source === previous.source &&
        input.document === previous.document &&
        input.mode === previous.mode &&
        input.snapshot === previous.snapshot &&
        input.annotation === previous.annotation &&
        input.citation === previous.citation &&
        input.partial === previous.partial &&
        input.resources === previous.resources &&
        input.hold === previous.hold;
      if (sameRenderInput && input.live === previous.live) return;
      if (sameRenderInput && !input.live) {
        // The queued render is dropped, so the reason the result is stale changes
        // from "live" to "demand" without a new result or busy flag.
        pause();
        publish({});
        return;
      }
      changed();
    },
    invalidate: changed,
    run() {
      const request = nextRequest();
      if (request === null) return;
      abandon();
      start(request, "explicit");
    },
    pause,
    fail(diagnostic) {
      abandon();
      // The failure names every selection a render reads, so a Citation or
      // Shared Partial preview matches it against its own input rather than
      // reading it as another preview's result.
      publish({
        result: failed(failedRender(renderIdentity(input), diagnostic)),
        busy: false,
        trigger: "automatic",
      });
    },
    [Symbol.dispose]() {
      closed = true;
      lifetime.dispose();
    },
  };
}
