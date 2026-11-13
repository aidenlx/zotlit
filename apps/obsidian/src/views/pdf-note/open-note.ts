// The open a PDF view's literature note controls run: the note of the Item
// the PDF belongs to, opened beside the PDF or written through Profile
// selection first.
import type { Scope, Stream } from "effect";
import { Effect } from "effect";
import type { View, WorkspaceLeaf } from "obsidian";

import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import { Workspace } from "@/lib/obsidian-workspace";
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
export const pdfNoteCommand = viewRuntime.fn(
  (effect: Effect.Effect<void, unknown, ViewServices | Scope.Scope>) =>
    effect.pipe(
      Effect.scoped,
      recover(
        (error) =>
          Effect.logWarning("The PDF view could not open its literature note", {
            error,
          }),
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
  // A split divides the active leaf; the PDF's leaf is the one to divide.
  yield* (yield* Workspace).setActiveLeaf(leaf, { focus: false });
  yield* openLiteratureNote(creation, itemKey, {
    source: "interactive",
    paneType: "split",
    reuseOpen: true,
  });
});
