// The render scheduler as atoms: a sleep a newer input interrupts, then the host's render Effect.

import type { WorkbenchReportContext } from "#/render/report";
import type { RenderRequest } from "#/render/request";
import type {
  TemplateRenderResult,
  RenderDiagnostic,
  RenderIdentity,
} from "#/render/result";
import { Cause, Effect, Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { WorkbenchHostError } from "./host";
import { held, staleReasonFor } from "./scheduler";
import type {
  RenderSchedulerInput,
  RenderSchedulerState,
  RenderTrigger,
} from "./scheduler";

import { captureRenderReport, engineEvidence } from "#/render/report";
import {
  failedRender,
  renderFailed,
  retainOutputs,
  templateSourceRevision,
  renderIdentity,
} from "#/render/result";

export interface RenderSchedulerAtomsOptions<
  R extends TemplateRenderResult,
  Services = never,
  RuntimeError = never,
> {
  /** The runtime every quiet time and render runs on, with the services `render` reads. */
  readonly runtime: Atom.AtomRuntime<Services, RuntimeError>;
  /**
   * What the host supplies for every render: a derived atom over its model.
   * Selections are compared by reference, so a new choice is a new object.
   */
  readonly input: Atom.Atom<RenderSchedulerInput>;
  /**
   * Renders one request. A template failure is part of the result; the error
   * channel holds a host failure, which the scheduler shows as a failed
   * attempt. A newer input interrupts it, so it must be interruptible.
   */
  readonly render: (
    request: RenderRequest,
  ) => Effect.Effect<R, WorkbenchHostError, Services>;
  /**
   * The host's own shape for a result this scheduler composed itself, so a
   * failure reads like every other result the host publishes.
   */
  readonly failed: (result: TemplateRenderResult) => R;
  readonly retain?: (kept: R, result: R) => R;
  /**
   * What names this Workbench in the report a failed attempt is copied as,
   * read once per landed result.
   */
  readonly reportContext?: () => WorkbenchReportContext;
  /** Quiet time after the last edit before a render starts. @default 300 */
  readonly debounceMs?: number;
}

export interface RenderSchedulerAtoms<
  R extends TemplateRenderResult = TemplateRenderResult,
> {
  /** What a preview reads. Mount it: its quiet time and render run while it is observed. */
  readonly state: Atom.Atom<RenderSchedulerState<R>>;
  /** Run: renders now, whatever the refresh setting says. */
  readonly run: Atom.Writable<void, void>;
  /** Stop: no new render starts; one already running finishes. */
  readonly pause: Atom.Writable<void, void>;
  /** Something a render reads changed outside the document. */
  readonly invalidate: Atom.Writable<void, void>;
  /** Shows `diagnostic` where the host could not supply what a render reads. */
  readonly fail: Atom.Writable<void, RenderDiagnostic>;
}

/** Each input change the scheduler answers by dropping its work, counted. */
interface InputGeneration {
  readonly input: RenderSchedulerInput;
  readonly epoch: number;
  /** Counts the changes that drop queued and running work. */
  readonly generation: number;
  /** Counts the times the host took the paper away, which clears the result. */
  readonly cleared: number;
}

/** One render the scheduler started, for the generation it answers. */
interface Job {
  readonly generation: number;
  readonly request: RenderRequest;
  readonly trigger: RenderTrigger;
}

interface Landed<R extends TemplateRenderResult> {
  readonly result: R | null;
  readonly trigger: RenderTrigger | null;
  readonly attempt: number;
  /** The last output each preview surface produced, whatever has failed since. */
  readonly produced: R | null;
  /** The Template Document `produced` was rendered from. */
  readonly producedDocument: string | undefined;
  /** `InputGeneration.cleared` when `result` landed; a later clear hides it. */
  readonly cleared: number;
}

/** Every input field a render reads: all but `live`, which never drops a render on its own. */
const RENDER_FIELDS = [
  "source",
  "document",
  "mode",
  "snapshot",
  "annotation",
  "citation",
  "partial",
  "resources",
  "hold",
] as const satisfies readonly (keyof RenderSchedulerInput)[];

function sameRenderInput(
  previous: RenderSchedulerInput,
  next: RenderSchedulerInput,
): boolean {
  return RENDER_FIELDS.every((field) => next[field] === previous[field]);
}

/** What a render would be asked for now, or `null` while nothing may run. */
function nextRequest(input: RenderSchedulerInput): RenderRequest | null {
  const { snapshot, annotation, citation, partial, resources } = input;
  if (held(input) || snapshot === null) return null;
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

/**
 * Whether a result describes the paper, example, caller, and mode the reader
 * is on now. The source is left out: an edit makes a result stale without
 * making it another preview's.
 */
function sameSelection(
  input: RenderSchedulerInput,
  result: RenderIdentity,
): boolean {
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

function sameState<R extends TemplateRenderResult>(
  a: RenderSchedulerState<R>,
  b: RenderSchedulerState<R>,
): boolean {
  return (
    a.result === b.result &&
    a.retained === b.retained &&
    a.busy === b.busy &&
    a.stale === b.stale &&
    a.staleReason === b.staleReason &&
    a.trigger === b.trigger &&
    a.attempt === b.attempt
  );
}

export function makeRenderSchedulerAtoms<
  R extends TemplateRenderResult,
  Services = never,
  RuntimeError = never,
>({
  runtime,
  input,
  render,
  failed,
  retain = retainOutputs,
  reportContext,
  debounceMs = 300,
}: RenderSchedulerAtomsOptions<
  R,
  Services,
  RuntimeError
>): RenderSchedulerAtoms<R> {
  const epoch = Atom.make(0);
  const inputGeneration = Atom.make((get): InputGeneration => {
    const next = get(input);
    const at = get(epoch);
    const previous = Option.getOrUndefined(get.self<InputGeneration>());
    if (previous === undefined) {
      return { input: next, epoch: at, generation: 0, cleared: 0 };
    }
    // No paper, nothing to render: whatever is shown describes another one.
    const cleared = next !== previous.input && next.snapshot === null;
    // A render in flight would answer for a source, paper, example, or mode
    // the reader has moved past, so it is dropped whatever the refresh setting
    // says; only Stop and On demand, which leave the input alone, let one
    // land. Turning Live back on starts the quiet time over.
    const dropped =
      cleared ||
      at !== previous.epoch ||
      !sameRenderInput(previous.input, next) ||
      (!previous.input.live && next.live);
    return {
      input: next,
      epoch: at,
      generation: previous.generation + (dropped ? 1 : 0),
      cleared: previous.cleared + (cleared ? 1 : 0),
    };
  });
  const generation = Atom.map(inputGeneration, ({ generation }) => generation);
  const cleared = Atom.map(inputGeneration, ({ cleared }) => cleared);
  const live = Atom.map(input, ({ live }) => live);
  /** The generation whose quiet time Run, Stop, or a host failure ended. */
  const cancelled = Atom.make(-1);
  const job = Atom.make<Job | null>(null);
  const landed = Atom.make<Landed<R>>({
    result: null,
    trigger: null,
    attempt: 0,
    produced: null,
    producedDocument: undefined,
    cleared: 0,
  });

  /**
   * Pairs each of a landed result's diagnostics with the attempt behind it,
   * once. From here on the report describes that attempt.
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

  /** Adds one landed result to `previous`, read against the input it landed on. */
  function land(
    previous: Landed<R>,
    {
      published,
      trigger,
      now,
      clearedNow,
    }: {
      readonly published: R;
      readonly trigger: RenderTrigger;
      readonly now: RenderSchedulerInput;
      readonly clearedNow: number;
    },
  ): Landed<R> {
    const attempt = previous.attempt + 1;
    const result = stamp(published, trigger, attempt);
    // A Property failure makes the note surface unsuccessful even when the
    // renderer returned its partial body; independent surfaces still land.
    const forRetention = result.diagnostics.some(
      ({ code }) => code === "property-error",
    )
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
    const keeps = !renderFailed(forRetention);
    return {
      result,
      trigger,
      attempt,
      produced: keeps
        ? previous.produced !== null &&
          previous.producedDocument === now.document
          ? retain(previous.produced, forRetention)
          : forRetention
        : previous.produced,
      producedDocument: keeps ? now.document : previous.producedDocument,
      cleared: clearedNow,
    };
  }

  // The quiet time after a change: a newer generation, Live turned off, Run,
  // Stop, or a host failure interrupts it.
  const quiet = runtime.atom((get) => {
    const at = get(generation);
    if (!get(live) || get(cancelled) === at) return Effect.void;
    const request = nextRequest(get.once(input));
    if (request === null) return Effect.void;
    return Effect.sleep(debounceMs).pipe(
      Effect.andThen(
        Atom.set(job, { generation: at, request, trigger: "automatic" }),
      ),
    );
  });

  // The render in flight: a newer generation or another job interrupts it,
  // which is what drops a result the reader has moved past.
  const rendering = runtime.atom((get) => {
    const at = get(generation);
    const current = get(job);
    if (current === null || current.generation !== at) return Effect.void;
    const { request, trigger } = current;
    return render(request).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
        // The host failure carries the engine's error, whole.
        const failure = Cause.squash(cause);
        const error =
          failure instanceof WorkbenchHostError ? failure.cause : failure;
        return Effect.succeed(
          failed(
            failedRender(renderIdentity(request), {
              code: "render-error",
              message: error instanceof Error ? error.message : String(error),
              evidence: engineEvidence(error),
              part: "render",
            }),
          ),
        );
      }),
      Effect.flatMap((result) =>
        Effect.gen(function* () {
          // A render that answers at once lands after this atom is built:
          // landing inside the build would rebuild it and render again.
          yield* Effect.promise(() => Promise.resolve());
          const now = yield* Atom.get(input);
          const clearedNow = yield* Atom.get(cleared);
          yield* Atom.update(landed, (previous) =>
            land(previous, { published: result, trigger, now, clearedNow }),
          );
        }),
      ),
    );
  });

  const state = Atom.make((get): RenderSchedulerState<R> => {
    get(quiet);
    const now = get(input);
    const busy = AsyncResult.isWaiting(get(rendering));
    const last = get(landed);
    const result = last.cleared === get(cleared) ? last.result : null;
    const { produced, producedDocument } = last;
    // Only a failure sends the reader back to working output, and only where
    // that output still answers for the document and the selection they are
    // reading now.
    const broken =
      now.hold === "invalid" ||
      (result !== null && result.diagnostics.length > 0);
    const retained =
      broken &&
      produced !== null &&
      producedDocument === now.document &&
      sameSelection(now, produced)
        ? produced
        : null;
    const identityMismatch =
      result !== null &&
      (result.sourceRevision !== templateSourceRevision(now.source) ||
        !sameSelection(now, result));
    return {
      result,
      retained,
      busy,
      stale: held(now) || identityMismatch,
      staleReason: staleReasonFor(now, result !== null && !identityMismatch),
      trigger: last.trigger,
      attempt: last.attempt,
    };
  }).pipe(Atom.withEquality(sameState<R>));

  const command = <W>(
    write: (ctx: Atom.WriteContext<void>, value: W) => void,
  ) => Atom.writable<void, W>(() => undefined, write);

  return {
    state,
    run: command((ctx) => {
      const request = nextRequest(ctx.get(input));
      if (request === null) return;
      const at = ctx.get(generation);
      ctx.set(cancelled, at);
      ctx.set(job, { generation: at, request, trigger: "explicit" });
    }),
    pause: command((ctx) => ctx.set(cancelled, ctx.get(generation))),
    invalidate: command((ctx) => ctx.set(epoch, ctx.get(epoch) + 1)),
    fail: command((ctx, diagnostic: RenderDiagnostic) => {
      const now = ctx.get(input);
      ctx.set(cancelled, ctx.get(generation));
      ctx.set(job, null);
      // The failure names every selection a render reads, so a Citation or
      // Shared Partial preview matches it against its own input.
      ctx.set(
        landed,
        land(ctx.get(landed), {
          published: failed(failedRender(renderIdentity(now), diagnostic)),
          trigger: "automatic",
          now,
          clearedNow: ctx.get(cleared),
        }),
      );
    }),
  };
}
