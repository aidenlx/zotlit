// A view-owned scheduler consumes values and rejects work for superseded inputs.
import type { CitationPreviewSelection } from "#/render/citation-examples";
import type { PartialPreviewSelection } from "#/render/partial-preview";
import type { RenderRequest, RenderResources } from "#/render/request";
import type {
  TemplateRenderResult,
  RenderDiagnostic,
  RenderIdentity,
} from "#/render/result";
import type { AnnotationExample } from "#/render/sample-annotations";
import type { ItemSnapshot } from "#/snapshot/index";

import type { PreviewMode } from "./store";

import {
  failedRender,
  renderFailed,
  templateSourceRevision,
  renderIdentity,
} from "#/render/result";

export interface RenderSchedulerInput {
  readonly source: string;
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
   * The last result that produced output, kept while `result` is a failed
   * attempt the reader can still compare against it. Null once the retained
   * output describes a paper, example, caller, or mode the reader has left,
   * which is what keeps another preview's result out of this one.
   */
  readonly retained: R | null;
  /** Set from the moment a render starts until its result lands or is dropped. */
  readonly busy: boolean;
  /** Whether `result` describes a draft, paper, or mode the reader has left. */
  readonly stale: boolean;
  /** Why `result` is stale, or why none exists yet; `null` while the shown result is current. */
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
  /** Renders one request on the calling thread. */
  readonly render: (request: RenderRequest) => Promise<R>;
  /**
   * The host's own shape for a result this scheduler composed itself, so a
   * failure reads like every other result the host publishes.
   */
  readonly failed: (result: TemplateRenderResult) => R;
  readonly input: RenderSchedulerInput;
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

/** Whether nothing may render, for either reason a host gives. */
function held(input: Pick<RenderSchedulerInput, "hold">): boolean {
  return input.hold === true || input.hold === "invalid";
}

export function createRenderScheduler<R extends TemplateRenderResult>({
  render,
  failed,
  input: initial,
  debounceMs = 300,
}: RenderSchedulerOptions<R>): RenderScheduler<R> {
  let input = initial;
  let state: RenderSchedulerState<R> = {
    result: null,
    retained: null,
    busy: false,
    stale: false,
    staleReason: staleReasonFor(initial, false),
    trigger: null,
    attempt: 0,
  };
  // The last result that produced output, whatever has failed since.
  let produced: R | null = null;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let current: RenderIdentity | undefined;
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

  function publish(next: {
    result?: R | null;
    busy?: boolean;
    trigger?: RenderTrigger;
  }): void {
    if (closed) return;
    const result = next.result === undefined ? state.result : next.result;
    const busy = next.busy ?? state.busy;
    if (result !== null && !renderFailed(result)) produced = result;
    // Only a failure sends the reader back to working output, and only where
    // that output still answers for the selection they are reading now. A
    // document the parser refuses is such a failure: no attempt ever ran.
    const broken =
      input.hold === "invalid" || (result !== null && renderFailed(result));
    const retained =
      broken && produced !== null && sameSelection(produced) ? produced : null;
    const identityMismatch =
      result !== null &&
      (result.sourceRevision !== templateSourceRevision(input.source) ||
        !sameSelection(result));
    const stale = held(input) || identityMismatch;
    const staleReason = staleReasonFor(
      input,
      result !== null && !identityMismatch,
    );
    const landed = next.trigger !== undefined;
    if (
      !landed &&
      result === state.result &&
      retained === state.retained &&
      busy === state.busy &&
      stale === state.stale &&
      staleReason === state.staleReason
    ) {
      return;
    }
    state = {
      result,
      retained,
      busy,
      stale,
      staleReason,
      trigger: next.trigger ?? state.trigger,
      attempt: landed ? state.attempt + 1 : state.attempt,
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
    void render(request).then(
      (result) => {
        if (current !== identity) return;
        current = undefined;
        publish({ result, busy: false, trigger });
      },
      // A template that throws stops this render, not the host around it.
      (error: unknown) => {
        if (current !== identity) return;
        current = undefined;
        publish({
          result: failed(
            failedRender(identity, {
              code: "render-error",
              message: error instanceof Error ? error.message : String(error),
              part: "render",
            }),
          ),
          busy: false,
          trigger,
        });
      },
    );
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
