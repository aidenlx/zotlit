export { NoteFeature } from "./service";
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
export { openCompanionNote, companionNoteNotice } from "./companion-view";
export { noteOperationDiagnosticContent } from "./update-single";
export {
  awaitProfileSwitchConsent,
  switchNoteProfileInteractively,
  type ProfileSwitchConsent,
} from "./switch-view";
export {
  type InteractiveCreationOptions,
  type InteractiveCreationPorts,
} from "./creation-view";
export {
  type CompanionNoteTarget,
  type CreateNoteDiagnostic,
  type CreateNoteResult,
  type CreationProfileSources,
  type CreationProfileSelection,
  type CreationProfileSource,
  type CreationSelectionProblem,
  type ProfileNotePreview,
  type ProfilePreview,
  type NoteFeatureHandle,
  type UpdateResult,
  type UpdateScope,
} from "./operations";
export {
  type ProfileNotePreviewOptions,
  type PreparedProfileSwitch,
} from "./types";
export { type AnnotationCitation } from "./annotation-citation";
