// Annotation note gestures as one tag for the view registry.
import { Context, Effect, Layer } from "effect";

import type { AnnotationRepository } from "@/services/annotation-repository/service";
import type { UseLedger } from "@/services/use-ledger/service";

import { renderAnnotationCitation } from "./annotation-citation";
import type { AnnotationCitation } from "./annotation-citation";
import type { NoteCitationServices } from "./citations-handle";
import { commitAnnotation } from "./insert-action";
import type {
  AnnotationInsertRequest,
  AnnotationInsertOutcome,
} from "./insert-action";

export class AnnotationNoteActions extends Context.Service<
  AnnotationNoteActions,
  {
    citation(key: string): Effect.Effect<AnnotationCitation, unknown>;
    insert(
      options: AnnotationInsertRequest,
    ): Effect.Effect<
      AnnotationInsertOutcome,
      Effect.Error<ReturnType<typeof commitAnnotation>>
    >;
  }
>()("zotlit/note-feature/AnnotationNoteActions") {}

export const layerAnnotationNoteActions: Layer.Layer<
  AnnotationNoteActions,
  never,
  NoteCitationServices | AnnotationRepository | UseLedger
> = Layer.effect(
  AnnotationNoteActions,
  Effect.gen(function* () {
    const context = yield* Effect.context<
      NoteCitationServices | AnnotationRepository | UseLedger
    >();
    return AnnotationNoteActions.of({
      citation: Effect.fn("AnnotationNoteActions.citation")((key) =>
        renderAnnotationCitation(key).pipe(Effect.provideContext(context)),
      ),
      insert: Effect.fn("AnnotationNoteActions.insert")((options) =>
        commitAnnotation(options).pipe(Effect.provideContext(context)),
      ),
    });
  }),
);
