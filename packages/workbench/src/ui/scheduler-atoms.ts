// The render scheduler as atoms: a sleep a newer input interrupts, then the host's render Effect.

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
import { Cause, Effect, Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { WorkbenchHostError } from "./host";
import type { PreviewMode } from "./model";

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

/** Why the shown result is stale; `current` says it matches the input. */
export function staleReasonFor(
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
export function rebased<R extends TemplateRenderResult>(
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
export function rebaser<R extends TemplateRenderResult>() {
  let last: { result: R; to: string; out: R } | null = null;
  return (result: R | null, from: string, to: string): R | null => {
    if (result === null) return null;
    if (last?.result !== result || last.to !== to)
      last = { result, to, out: rebased(result, from, to) };
    return last.out;
  };
}

/** Whether nothing may render, for either reason a host gives. */
export function held(input: Pick<RenderSchedulerInput, "hold">): boolean {
  return input.hold === true || input.hold === "invalid";
}

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

/** What a render or a host failure hands the scheduler to land. */
interface Arrival<R extends TemplateRenderResult> {
  readonly published: R;
  /** The draft `published` was rendered from. */
  readonly source: string;
  readonly trigger: RenderTrigger;
}

/** A failure the host reported, with the input it was reported against. */
interface Failure<R extends TemplateRenderResult> extends Arrival<R> {
  readonly now: RenderSchedulerInput;
  readonly clearedNow: number;
}

/** The landed state, and the arrivals already added to it. */
interface Landing<R extends TemplateRenderResult> {
  readonly landed: Landed<R>;
  readonly rendered: Arrival<R> | undefined;
  readonly failure: Failure<R> | null;
}

interface Landed<R extends TemplateRenderResult> {
  readonly result: R | null;
  /** The draft `result` was rendered from. */
  readonly source: string;
  readonly trigger: RenderTrigger | null;
  readonly attempt: number;
  /** The last output each preview surface produced, whatever has failed since. */
  readonly produced: R | null;
  /**
   * The draft whose Managed Frontmatter positions `produced` names: the one
   * the newest attempt rendered.
   */
  readonly producedSource: string;
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
  /** The newest failure the host reported. */
  const failure = Atom.make<Failure<R> | null>(null);

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
    { published, source, trigger }: Arrival<R>,
    {
      now,
      clearedNow,
    }: {
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
    // What was kept names the positions of the draft the attempt before
    // rendered, so it moves to this attempt's draft before the two combine.
    return {
      result,
      source,
      trigger,
      attempt,
      produced: keeps
        ? previous.produced !== null &&
          previous.producedDocument === now.document
          ? retain(
              rebased(previous.produced, previous.producedSource, source),
              forRetention,
            )
          : forRetention
        : previous.produced,
      producedSource: keeps ? source : previous.producedSource,
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
    if (current === null || current.generation !== at)
      return Effect.succeed<Arrival<R> | undefined>(undefined);
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
      Effect.map((published): Arrival<R> => ({
        published,
        source: request.source,
        trigger,
      })),
    );
  });

  // What has landed: each render's result and each host failure, added once,
  // in the order they arrive. The render answers through its own value, so a
  // render that answers at once writes no atom while it is being built.
  // Each source is read only beside the result it names, so neither matters
  // before one lands.
  const landing = Atom.make((get): Landing<R> => {
    const previous = Option.getOrElse(
      get.self<Landing<R>>(),
      (): Landing<R> => ({
        landed: {
          result: null,
          source: "",
          trigger: null,
          attempt: 0,
          produced: null,
          producedSource: "",
          producedDocument: undefined,
          cleared: 0,
        },
        rendered: undefined,
        failure: null,
      }),
    );
    // An interrupted render keeps the value of the last one that answered.
    const rendered = Option.getOrUndefined(AsyncResult.value(get(rendering)));
    const reported = get(failure);
    let { landed } = previous;
    if (rendered !== undefined && rendered !== previous.rendered)
      landed = land(landed, rendered, {
        now: get.once(input),
        clearedNow: get.once(cleared),
      });
    if (reported !== null && reported !== previous.failure)
      landed = land(landed, reported, reported);
    return { landed, rendered, failure: reported };
  });
  const landed = Atom.map(landing, (state) => state.landed);

  // A result stands across an edit until the next one lands, so each is read
  // against the draft on screen; the same pair answers with the same object.
  const shownResult = rebaser<R>();
  const shownRetained = rebaser<R>();
  const state = Atom.make((get): RenderSchedulerState<R> => {
    get(quiet);
    const now = get(input);
    const busy = AsyncResult.isWaiting(get(rendering));
    const last = get(landed);
    const result = last.cleared === get(cleared) ? last.result : null;
    const { produced, producedSource, producedDocument } = last;
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
        ? shownRetained(produced, producedSource, now.source)
        : null;
    const identityMismatch =
      result !== null &&
      (result.sourceRevision !== templateSourceRevision(now.source) ||
        !sameSelection(now, result));
    return {
      result: shownResult(result, last.source, now.source),
      retained,
      busy,
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
      ctx.set(failure, {
        published: failed(failedRender(renderIdentity(now), diagnostic)),
        source: now.source,
        trigger: "automatic",
        now,
        clearedNow: ctx.get(cleared),
      });
    }),
  };
}
