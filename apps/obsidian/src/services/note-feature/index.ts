export { type NoteFeatureDeps } from "./context";
export { noteOperationDiagnosticContent } from "./update-single";
export {
  confirmProfileSwitch,
  switchNoteProfileInteractively,
  type InteractiveProfileSwitchDeps,
  type ProfileSwitchConsent,
} from "./switch-view";
export {
  createNoteInteractively,
  type InteractiveCreationDeps,
} from "./creation-view";
export {
  createNoteFeature,
  type CreateNoteDiagnostic,
  type CreateNoteResult,
  type CreationProfileSources,
  type CreationProfileSelection,
  type PreparedCreationProfile,
  type ProfileNotePreview,
  type ProfileNotePreviewOptions,
  type ProfilePreview,
  type PreparedProfileSwitch,
  type NoteFeature,
  type UpdateResult,
  type UpdateScope,
} from "./operations";
