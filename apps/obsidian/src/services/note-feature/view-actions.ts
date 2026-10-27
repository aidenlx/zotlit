// Annotation note gestures as one tag for the view registry.
import { Context, Effect, Layer } from "effect";

import { renderAnnotationCitation } from "./annotation-citation";
import type { AnnotationCitation } from "./annotation-citation";
import type { NoteCitationServices } from "./citations-handle";
import { prepareAnnotationInsert } from "./insert-annotation";
import type {
  AnnotationInsert,
  AnnotationInsertOptions,
} from "./insert-annotation";

export class AnnotationNoteActions extends Context.Service<
  AnnotationNoteActions,
  {
    citation(key: string): Effect.Effect<AnnotationCitation, unknown>;
    prepare(
      options: AnnotationInsertOptions,
    ): Effect.Effect<AnnotationInsert | null, unknown>;
  }
>()("zotlit/note-feature/AnnotationNoteActions") {}

export const layerAnnotationNoteActions: Layer.Layer<
  AnnotationNoteActions,
  never,
  NoteCitationServices
> = Layer.effect(
  AnnotationNoteActions,
  Effect.gen(function* () {
    const context = yield* Effect.context<NoteCitationServices>();
    return AnnotationNoteActions.of({
      citation: Effect.fn("AnnotationNoteActions.citation")((key) =>
        renderAnnotationCitation(key).pipe(Effect.provideContext(context)),
      ),
      prepare: Effect.fn("AnnotationNoteActions.prepare")((options) =>
        prepareAnnotationInsert(options).pipe(Effect.provideContext(context)),
      ),
    });
  }),
);
