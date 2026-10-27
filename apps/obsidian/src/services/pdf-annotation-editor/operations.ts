// PDF.js supplies the geometry; the repository owns each Annotation write.
import { Effect, Schema } from "effect";

import type {
  PdfPosition,
  PdfTextStructure,
  TextSelection,
} from "@zotlit/pdf-structure";

import { withLogCategory } from "@/lib/effect-log";
import type { AnnotationRepository } from "@/services/annotation-repository/service";
import type {
  AnnotationDraft,
  GeometryInput,
  MutationState,
} from "@/services/annotation-repository/write";

import type { EditablePosition } from "./geometry-edit";

/** A PDF.js read that could not produce the geometry or text for a gesture. */
class PdfStructureReadError extends Schema.TaggedError<
  PdfStructureReadError,
  { readonly brand: unique symbol }
>()("PdfStructureReadError", { cause: Schema.Defect() }) {}

/** Read both placement fields before asking the repository to create a mark. */
export const createMark = Effect.fn("PdfAnnotationEditor.createMark")(
  function* (
    annotations: Pick<AnnotationRepository["Service"], "createAnnotation">,
    {
      attachmentKey,
      structure,
      draft,
      previous,
      group,
    }: {
      attachmentKey: string;
      structure: PdfTextStructure;
      draft: Omit<AnnotationDraft, "parentKey" | "sortIndex" | "pageLabel"> & {
        position: PdfPosition;
      };
      previous: { pageLabel: string; pageIndex: number }[];
      group?: string;
    },
  ) {
    const [sortIndex, pageLabel] = yield* Effect.tryPromise({
      try: () =>
        Promise.all([
          structure.sortIndex(draft.position),
          structure.pageLabel(draft.position.pageIndex, previous),
        ]),
      catch: (cause) => new PdfStructureReadError({ cause }),
    });
    return yield* annotations.createAnnotation(
      attachmentKey,
      { ...draft, sortIndex, pageLabel },
      { group },
    );
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

/** Recompute the released position's Sort Index before its geometry write. */
export const saveGeometry = Effect.fn("PdfAnnotationEditor.saveGeometry")(
  function* (
    annotations: Pick<AnnotationRepository["Service"], "patchGeometry">,
    readSortIndex: (position: PdfPosition) => Promise<string | null>,
    {
      key,
      proposal,
      text,
      input,
      onRead,
    }: {
      key: string;
      proposal: EditablePosition;
      text?: string;
      input: GeometryInput;
      onRead: () => void;
    },
  ) {
    const sortIndex = yield* Effect.tryPromise({
      try: () => readSortIndex(proposal),
      catch: (cause) => new PdfStructureReadError({ cause }),
    });
    if (sortIndex === null) return { kind: "idle" } as const;
    onRead();
    return yield* annotations.patchGeometry(
      key,
      { position: proposal, sortIndex, ...(text !== undefined && { text }) },
      input,
    );
  },
  (operation) =>
    operation.pipe(
      Effect.catchTag(["PdfStructureReadError", "WriteRunFailed"], (error) =>
        Effect.logWarning("An Annotation geometry edit did not finish").pipe(
          Effect.annotateLogs({ error }),
          withLogCategory("pdf-annotation-editor"),
          Effect.as<MutationState>({
            kind: "failed",
            failure: { kind: "unknown-outcome" },
          }),
        ),
      ),
    ),
);
