export { type NoteFeatureDeps } from "./context";
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
  type ProfilePreview,
  type PreparedProfileSwitch,
  type NoteFeature,
  type UpdateResult,
  type UpdateScope,
} from "./operations";
