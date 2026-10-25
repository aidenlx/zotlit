// The legacy note creation flow the citekey editor opens a new note through.
import { createNoteInteractively } from "@/services/note-feature";
import type { InteractiveCreationDeps } from "@/services/note-feature";

import type { CitekeyNoteCreation } from "./service";

/**
 * A citation names one Item, so its note is created at once: the flow asks for
 * a Profile only where no Profile resolves (`direct`).
 */
export function citekeyNoteCreation(
  deps: InteractiveCreationDeps,
): CitekeyNoteCreation {
  return {
    createNote: (item) => createNoteInteractively(deps, item, { direct: true }),
  };
}
