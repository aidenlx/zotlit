// The batch confirmation delegates its optional Profile decision to the shared picker.
import type { ProfileSelector } from "@/lib/profile-stamp";
import type { InteractiveCreationDeps } from "@/services/note-feature";
import type {
  CreationProfileSelection,
  ProfilePreview,
} from "@/services/note-feature";
import { listInstalledStyles } from "@/services/pandoc/styles";
import { chooseLiteratureNoteProfile } from "@/views/quick-switch/profile-picker";

export type BatchProfilePickerDeps = Pick<
  InteractiveCreationDeps,
  "app" | "createProfile" | "importProfile" | "zoteroPref"
>;
export interface BatchProfilePickerOptions {
  indexedKey?: string;
  selection: CreationProfileSelection;
  previews: readonly ProfilePreview[];
}

export async function chooseBatchProfile(
  deps: BatchProfilePickerDeps,
  options: BatchProfilePickerOptions,
): Promise<ProfileSelector | undefined> {
  const styles = deps.zoteroPref.dataDir
    ? await listInstalledStyles(deps.zoteroPref.dataDir)
    : [];
  const choice = await chooseLiteratureNoteProfile(deps.app, {
    preselected: options.selection.selector,
    source: options.selection.source,
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
  });
  return choice?.id;
}
