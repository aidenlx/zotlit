// PDF.js supplies the geometry; the repository owns each Annotation write.
import { Cause, Effect, Exit, Fiber, Schema, Semaphore } from "effect";

import type {
  PdfPosition,
  PdfTextStructure,
  SelectedText,
  TextSelection,
} from "@zotlit/pdf-structure";

import type { EffectBridge } from "@/lib/effect-bridge";
import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import type { Notifier } from "@/lib/notifier";
import { historyOutcomeNotice } from "@/services/annotation-repository/actions";
import type { CopyInstant } from "@/services/annotation-repository/capability-copy";
import type {
  AnnotationRepository,
  CreateOutcome,
  HistoryDirection,
  HistoryOutcome,
  WriteRunFailed,
} from "@/services/annotation-repository/service";
import {
  groupFailureMessages,
  writeFailureReason,
} from "@/services/annotation-repository/write";
import type {
  AnnotationDraft,
  GeometryInput,
  MutationState,
  WriteFailure,
} from "@/services/annotation-repository/write";

import type { EditablePosition } from "./geometry-edit";

/** One write a PDF view started on its own Scope. */
export type WriteRun = Fiber.Fiber<unknown, never>;

/**
 * Forks a write onto a PDF view's own Scope, which the view's close closes: a
 * write still running then is interrupted, or finishes where it is
 * uninterruptible.
 */
export type BindingWrites = <A>(
  effect: Effect.Effect<A>,
) => Fiber.Fiber<A, never>;

/**
 * Settles when `run` has ended, however it ended: answered, interrupted by the
 * view's close, or ended by unload. Settled for `null`. Never rejects.
 */
export function settledOf(
  bridge: Pick<EffectBridge, "runPromiseExit">,
  run: WriteRun | null,
): Promise<void> {
  return run
    ? bridge.runPromiseExit(Fiber.await(run)).then(() => undefined)
    : Promise.resolve();
}

/**
 * A keystroke asked to edit under a block: probe Zotero first, because the
 * block may be one a probe clears, and report only what survives it.
 */
export const reportBlockedEdit = Effect.fn("PdfAnnotationEditor.editGesture")(
  function* (
    annotations: Pick<AnnotationRepository["Service"], "probe">,
    report: () => void,
  ) {
    yield* annotations.probe;
    report();
  },
);

/** A PDF.js read that could not produce the geometry or text for a gesture. */
class PdfStructureReadError extends Schema.TaggedError<
  PdfStructureReadError,
  { readonly brand: unique symbol }
>()("PdfStructureReadError", { cause: Schema.Defect() }) {}

/** The outcome of a write that failed before Zotero answered. */
const UNKNOWN_OUTCOME = {
  kind: "failed",
  failure: { kind: "unknown-outcome" },
} as const satisfies MutationState;

/** One committed create, answering the created key or `null`. */
export type CreateWrite = Effect.Effect<string | null>;

/** What one create does on the creation surfaces around its write. */
export interface CreateSeam {
  /** Holds the Attachment's list, so the create has a source to write to. */
  hold: () => Disposable;
  /** The create is on its way. */
  begin: () => void;
  /** Zotero created the Annotation. */
  created: (annotationKey: string) => void;
  /** The create made nothing, for `reason`; the seam says why. */
  failed: (reason: string) => void;
  /** However the create ended: the created key, or `null`. */
  end: (annotationKey: string | null) => void;
  /** The clock a cooldown's remaining seconds are read against. */
  now: () => CopyInstant;
}

/**
 * One create the researcher committed: read both placement fields, then ask
 * the repository to create the mark, with the Attachment's list held from
 * start to end. A create that made nothing says why through the seam; one
 * that failed or died before Zotero answered is one whose outcome ZotLit
 * never learned, so no committed draft goes without a notice.
 *
 * The read is interruptible: a reader closed or unloaded while PDF.js places
 * the mark sends nothing. From the send on, the create and what the seam does
 * with its answer are uninterruptible, so a close waits for Zotero's answer.
 *
 * @param create.whole whether the read is uninterruptible too: a Text Draft's
 *   typed text is created even when the view's close finished it.
 * @returns the created Annotation's Indexed Key, or `null`.
 */
export const createMark = Effect.fn("PdfAnnotationEditor.createMark")(
  function* (
    annotations: Pick<AnnotationRepository["Service"], "createAnnotation">,
    {
      attachmentKey,
      structure,
      draft,
      previous,
      group,
      whole = false,
    }: {
      attachmentKey: string;
      structure: PdfTextStructure;
      draft: Omit<AnnotationDraft, "parentKey" | "sortIndex" | "pageLabel"> & {
        position: PdfPosition;
      };
      previous: { pageLabel: string; pageIndex: number }[];
      group?: string;
      whole?: boolean;
    },
    seam: CreateSeam,
  ) {
    const unknown = () =>
      seam.failed(writeFailureReason(UNKNOWN_OUTCOME.failure, seam.now()));
    let key: string | null = null;
    return yield* Effect.uninterruptibleMask((restore) => {
      const read = Effect.tryPromise({
        try: () =>
          Promise.all([
            structure.sortIndex(draft.position),
            structure.pageLabel(draft.position.pageIndex, previous),
          ]),
        catch: (cause) => new PdfStructureReadError({ cause }),
      });
      const send = Effect.gen(function* () {
        const [sortIndex, pageLabel] = yield* whole ? read : restore(read);
        return yield* annotations.createAnnotation(
          attachmentKey,
          { ...draft, sortIndex, pageLabel },
          { group },
        );
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("An Annotation was not created").pipe(
            Effect.annotateLogs({ type: draft.type, error }),
            withLogCategory("pdf-annotation-editor"),
            Effect.as<CreateOutcome>(UNKNOWN_OUTCOME),
          ),
        ),
      );
      return Effect.acquireUseRelease(
        Effect.sync(() => {
          const held = seam.hold();
          seam.begin();
          return held;
        }),
        () =>
          Effect.map(send, (outcome) => {
            if (outcome.kind === "failed") {
              seam.failed(writeFailureReason(outcome.failure, seam.now()));
              return null;
            }
            key = outcome.annotationKey;
            seam.created(key);
            return key;
          }),
        (held, exit) =>
          Effect.sync(() => {
            if (
              key === null &&
              Exit.isFailure(exit) &&
              !Cause.hasInterruptsOnly(exit.cause)
            )
              unknown();
            seam.end(key);
            held[Symbol.dispose]();
          }),
      );
    });
  },
);

/** The writes of one reader that run one at a time, in the order asked. */
export const oneAtATime = (): Semaphore.Semaphore => Semaphore.makeUnsafe(1);

/**
 * A write that waits for the writes asked before it in `queue`, then runs as
 * `make` builds it then; `null` from `make` is a write that cannot run. The
 * wait is uninterruptible, so a write once asked for keeps its turn through a
 * close, and the write keeps its own interruptibility.
 */
export const queued = <A>(
  queue: Semaphore.Semaphore,
  make: () => Effect.Effect<A> | null,
): Effect.Effect<A | void> =>
  Effect.uninterruptibleMask((restore) =>
    queue.withPermits(1)(restore(Effect.suspend(() => make() ?? Effect.void))),
  );

/**
 * Place a settled text selection on the Structured Characters of its pages,
 * then hand the placement on. A read that failed places nothing.
 */
export const placeSelection = Effect.fn("PdfAnnotationEditor.placeSelection")(
  function* (
    structure: PdfTextStructure,
    selection: TextSelection,
    place: (captured: SelectedText | null) => void,
  ) {
    const captured = yield* captureText(structure, selection).pipe(
      Effect.catchTag("PdfStructureReadError", (error) =>
        Effect.logWarning(
          "Could not place the text selection on the page",
        ).pipe(
          Effect.annotateLogs({ error }),
          withLogCategory("pdf-annotation-editor"),
          Effect.as(null),
        ),
      ),
    );
    place(captured);
  },
);

/** A settled DOM selection waits for PDF.js inside the reader's scope. */
export const captureText = Effect.fn("PdfAnnotationEditor.captureText")(
  (structure: PdfTextStructure, selection: TextSelection) =>
    Effect.tryPromise({
      try: () => structure.selectText(selection),
      catch: (cause) => new PdfStructureReadError({ cause }),
    }),
);

/**
 * Save a released Geometry Edit: recompute its Sort Index, write it, and say
 * through the Notifier why it did not land. A read or a write that failed is
 * an outcome ZotLit never learned.
 *
 * The read is interruptible: a reader closed while the index is computed
 * sends nothing, and its mark goes with it. From the send on, the write and
 * its notice are uninterruptible, so a close waits for Zotero's answer and a
 * refused edit is still told.
 *
 * @param options.end ends the adjustment the mark draws: called once the
 *   index is read, and again however the save ended.
 * @param options.message the notice for one failure.
 */
export const saveGeometry = Effect.fn("PdfAnnotationEditor.saveGeometry")(
  function* (
    annotations: Pick<AnnotationRepository["Service"], "patchGeometry">,
    notifier: Pick<Notifier["Service"], "show">,
    {
      readSortIndex,
      key,
      proposal,
      text,
      input,
      end,
      now,
      message,
    }: {
      readSortIndex: (position: PdfPosition) => Promise<string | null>;
      key: string;
      proposal: EditablePosition;
      text?: string;
      input: GeometryInput;
      end: () => void;
      now: () => CopyInstant;
      message: FailureMessage;
    },
  ) {
    const save = Effect.fnUntraced(function* (
      restore: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>,
    ) {
      const sortIndex = yield* restore(
        Effect.tryPromise({
          try: () => readSortIndex(proposal),
          catch: (cause) => new PdfStructureReadError({ cause }),
        }),
      );
      if (sortIndex === null) return { kind: "idle" } as const;
      end();
      return yield* annotations.patchGeometry(
        key,
        { position: proposal, sortIndex, ...(text !== undefined && { text }) },
        input,
      );
    });
    return yield* Effect.uninterruptibleMask((restore) =>
      reportWrite(
        notifier,
        save(restore).pipe(
          Effect.catchTag(
            ["PdfStructureReadError", "WriteRunFailed"],
            (error) =>
              Effect.logWarning(
                "An Annotation geometry edit did not finish",
              ).pipe(
                Effect.annotateLogs({ error }),
                withLogCategory("pdf-annotation-editor"),
                Effect.as<MutationState>(UNKNOWN_OUTCOME),
              ),
          ),
        ),
        { verb: "edit", now, message },
      ),
    ).pipe(Effect.ensuring(Effect.sync(end)));
  },
);

/** The notice for one write that did not land. */
type FailureMessage = (failure: WriteFailure, now: CopyInstant) => string;

/**
 * Run the writes of one verb, and say why through the Notifier, once per
 * reason, for each that did not land. A send that failed is an outcome ZotLit
 * never learned. An interrupt, such as plugin unload, passes on with no
 * notice.
 *
 * @param options.message the notice for one failure; a Geometry Edit names
 *   itself.
 * @param options.now the clock a cooldown's remaining seconds are read against.
 * @returns the outcome of each write.
 * @see apps/obsidian/policies/ui-seams.md
 */
export const reportWrites = Effect.fn("PdfAnnotationEditor.reportWrites")(
  function* <E>(
    notifier: Pick<Notifier["Service"], "show">,
    send: Effect.Effect<readonly MutationState[], E>,
    {
      verb,
      now,
      message,
    }: { verb: string; now: () => CopyInstant; message?: FailureMessage },
  ) {
    const exit = yield* Effect.exit(send);
    if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause))
      return yield* Effect.failCause(exit.cause);
    if (Exit.isFailure(exit))
      yield* Effect.logWarning("A write failed before Zotero answered").pipe(
        Effect.annotateLogs({ verb, error: Cause.squash(exit.cause) }),
        withLogCategory("pdf-annotation-editor"),
      );
    const outcomes = Exit.isSuccess(exit) ? exit.value : [UNKNOWN_OUTCOME];
    for (const text of groupFailureMessages(outcomes, now(), message))
      yield* notifier.show(text);
    return outcomes;
  },
);

/** {@link reportWrites} for one write. */
export const reportWrite = <E>(
  notifier: Pick<Notifier["Service"], "show">,
  write: Effect.Effect<MutationState, E>,
  options: { verb: string; now: () => CopyInstant; message?: FailureMessage },
) =>
  reportWrites(
    notifier,
    Effect.map(write, (state) => [state]),
    options,
  );

/**
 * Recolour these Annotations in Zotero: one alone, or two or more as one
 * History Step where each keeps its own outcome.
 *
 * @param annotationKeys Indexed Keys, in list order.
 */
export const recolorMarks = (
  annotations: Pick<
    AnnotationRepository["Service"],
    "patchColor" | "patchColors"
  >,
  annotationKeys: readonly string[],
  color: string,
): Effect.Effect<readonly MutationState[], WriteRunFailed> => {
  const [first] = annotationKeys;
  if (first === undefined) return Effect.succeed([]);
  return annotationKeys.length === 1
    ? Effect.map(annotations.patchColor(first, color), (state) => [state])
    : annotations.patchColors(annotationKeys, color);
};

/**
 * Erase these Annotations in Zotero: one alone, or two or more as one History
 * Step where each keeps its own outcome.
 *
 * @param annotationKeys Indexed Keys, in list order.
 */
export const eraseMarks = (
  annotations: Pick<
    AnnotationRepository["Service"],
    "deleteAnnotation" | "deleteAnnotations"
  >,
  annotationKeys: readonly string[],
): Effect.Effect<readonly MutationState[], WriteRunFailed> => {
  const [first] = annotationKeys;
  if (first === undefined) return Effect.succeed([]);
  return annotationKeys.length === 1
    ? Effect.map(annotations.deleteAnnotation(first), (state) => [state])
    : annotations.deleteAnnotations(annotationKeys);
};

/**
 * Take one History Step on an Attachment, and say through the Notifier what
 * the reader should know of it: a step Zotero moved under, one that did not
 * land, or one that put an Annotation back under a new creator. A step that
 * failed before Zotero answered is one whose outcome ZotLit never learned.
 *
 * The step itself is uninterruptible: the repository moves the step to the
 * other stack only once its writes answered, so a reader closed under it
 * waits for that answer. What the reader is told runs after, and the close
 * ends it.
 *
 * @param options.now the clock a cooldown's remaining seconds are read against.
 */
export const stepMarkHistory = Effect.fn("PdfAnnotationEditor.stepHistory")(
  function* (
    annotations: Pick<AnnotationRepository["Service"], "undo" | "redo">,
    notifier: Pick<Notifier["Service"], "show">,
    {
      attachmentKey,
      direction,
      now,
    }: {
      attachmentKey: string;
      direction: HistoryDirection;
      now: () => CopyInstant;
    },
  ) {
    const outcome = yield* Effect.uninterruptible(
      (direction === "undo"
        ? annotations.undo(attachmentKey)
        : annotations.redo(attachmentKey)
      ).pipe(
        recover(
          (cause) =>
            Effect.logWarning(
              "A History Step failed before Zotero answered",
            ).pipe(
              Effect.annotateLogs({ direction, error: Cause.squash(cause) }),
              withLogCategory("pdf-annotation-editor"),
            ),
          Effect.succeed<HistoryOutcome>(UNKNOWN_OUTCOME),
        ),
      ),
    );
    const notice = historyOutcomeNotice(outcome, now());
    if (notice !== null) yield* notifier.show(notice);
    return outcome;
  },
);

/**
 * One Annotation History press of a reader: its step, then the landing on
 * what the step changed, once the presses before it have landed.
 */
export const pressHistory = Effect.fn("PdfAnnotationEditor.pressHistory")(
  function* (
    presses: Semaphore.Semaphore,
    step: Effect.Effect<HistoryOutcome>,
    land: (outcome: HistoryOutcome) => Promise<void> | void,
  ) {
    yield* presses.withPermits(1)(
      Effect.flatMap(step, (outcome) =>
        Effect.promise(async () => land(outcome)),
      ),
    );
  },
);

/**
 * Read an Attachment's Annotations for the marks of an open PDF. A read that
 * failed is logged and fails on; an interrupt passes on unlogged.
 *
 * @param path the open file, which the log names.
 */
export const readMarks = (
  annotations: Pick<AnnotationRepository["Service"], "read">,
  attachmentKey: string,
  path: string | null,
) =>
  annotations.read(attachmentKey).pipe(
    Effect.tapCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.void
        : Effect.logWarning(
            "Failed to read the annotations of an open PDF",
          ).pipe(
            Effect.annotateLogs({
              error: Cause.squash(cause),
              path,
              attachmentKey,
            }),
            withLogCategory("pdf-annotation-editor"),
          ),
    ),
  );
