// The batch confirmation delegates its optional Profile decision to the shared picker.
import { Effect } from "effect";

import { awaitModal } from "@/lib/effect-modal";
import type { ProfileSelector } from "@/lib/profile-stamp";
import type { InteractiveCreationPorts } from "@/services/note-feature";
import type {
  CreationProfileSelection,
  ProfilePreview,
} from "@/services/note-feature";
import { installedStyles } from "@/services/note-feature/creation-view";
import { openLiteratureNoteProfile } from "@/views/quick-switch/profile-picker";
import type { LiteratureNoteProfileChoice } from "@/views/quick-switch/profile-picker";

export type BatchProfilePickerDeps = Pick<
  InteractiveCreationPorts,
  "app" | "createProfile" | "importProfile"
>;
export interface BatchProfilePickerOptions {
  indexedKey?: string;
  selection: CreationProfileSelection;
  previews: readonly ProfilePreview[];
  /** Why automatic selection stopped for the rows the choice governs. */
  problem?: string;
}

/**
 * The user's Profile for the rows a batch choice governs, or `undefined` when
 * the picker closes. An interrupt closes the picker.
 */
export const chooseBatchProfile = Effect.fnUntraced(function* (
  deps: BatchProfilePickerDeps,
  options: BatchProfilePickerOptions,
) {
  const styles = yield* installedStyles;
  const picker: Parameters<typeof openLiteratureNoteProfile>[1] = {
    preselected: options.selection.selector,
    matchContext: "batch",
    source: options.selection.source,
    candidates:
      options.selection.problem?.kind === "overlap"
        ? options.selection.problem.candidates.map(({ id }) => id)
        : undefined,
    reason: options.selection.reason,
    problem: options.problem,
    previews: options.previews,
    styles,
    onNew: async () => {
      const created = await deps.createProfile({
        indexedKey: options.indexedKey,
        useForNote: false,
      });
      return created
        ? { id: created.profile.id, label: created.profile.label }
        : undefined;
    },
    onImport: async () => {
      await deps.importProfile({ indexedKey: options.indexedKey });
    },
  };
  const choice = yield* awaitModal<LiteratureNoteProfileChoice | undefined>(
    (resolve) => openLiteratureNoteProfile(deps.app, picker, resolve),
  );
  const selector: ProfileSelector | undefined = choice?.id;
  return selector;
});
