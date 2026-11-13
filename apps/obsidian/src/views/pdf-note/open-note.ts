// The open behind every literature note control of a PDF view.
import type { Scope, Stream } from "effect";
import { Effect } from "effect";
import type { View, WorkspaceLeaf } from "obsidian";

import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import { viewRuntime } from "@/lib/view-atoms";
import type { ViewServices } from "@/lib/view-atoms";
import type { InteractiveCreationPorts } from "@/services/note-feature/creation-view";
import { openLiteratureNote } from "@/services/note-feature/navigation";
import type { ReaderSession } from "@/services/reader-session/session";

/** The Reader Session of each bound PDF view. */
export type PdfSessions = Stream.Stream<ReadonlyMap<View, ReaderSession>>;

/**
 * Runs each open beside the others. A failure is logged here, where the
 * gesture that started it has nothing to show.
 */
export const pdfNoteOpens = viewRuntime.fn(
  (effect: Effect.Effect<void, unknown, ViewServices | Scope.Scope>) =>
    effect.pipe(
      Effect.scoped,
      recover(
        (error) =>
          Effect.logWarning(
            "The PDF view could not open its literature note",
          ).pipe(Effect.annotateLogs({ error })),
        Effect.void,
      ),
      withLogCategory("pdf-note"),
    ),
  { concurrent: true },
);

/**
 * Open the Literature Note of `itemKey` beside the PDF in `leaf`, or write it
 * first where it has none. A tab that already shows the note comes forward.
 */
export const openNoteBeside = Effect.fn("PdfNote.openNoteBeside")(function* (
  creation: InteractiveCreationPorts,
  leaf: WorkspaceLeaf,
  itemKey: string,
) {
  yield* openLiteratureNote(creation, itemKey, {
    source: "interactive",
    beside: leaf,
  });
});
