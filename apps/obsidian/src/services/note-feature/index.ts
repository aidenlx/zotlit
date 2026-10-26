export { NoteFeature, layerNoteFeature } from "./service";
export { bindNoteFeature } from "./handle";
export {
  applyComposedFrontmatter,
  composeLiteratureNote,
  prepareLiteratureNote,
  type ComposedNote,
  type ComposeFrontmatterInput,
  type ComposeNoteDeps,
  type ComposeNoteInput,
  type ComposeProfile,
  type ComposeRefusal,
  type PreparedComposition,
} from "./compose";
export {
  openCompanionNote,
  companionNoteNotice,
  type CompanionNoteDeps,
} from "./companion-view";
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
  type InteractiveCreationOptions,
} from "./creation-view";
export {
  type CompanionNoteTarget,
  type CreateNoteDiagnostic,
  type CreateNoteResult,
  type CreationProfileSources,
  type CreationProfileSelection,
  type CreationProfileSource,
  type CreationSelectionProblem,
  type PreparedCreationProfile,
  type ProfileNotePreview,
  type ProfileNotePreviewOptions,
  type ProfilePreview,
  type PreparedProfileSwitch,
  type NoteFeatureHandle,
  type UpdateResult,
  type UpdateScope,
} from "./operations";
export { type AnnotationCitation } from "./annotation-citation";
