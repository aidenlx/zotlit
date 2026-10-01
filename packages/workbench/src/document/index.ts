export { ANNOTATION_HEADER } from "@zotlit/templates/constants";

export {
  entryPosition,
  entrySlice,
  externalEdit,
  sliceEdit,
  WorkbenchDocumentController,
} from "./controller";
export type {
  WorkbenchAnnotationSection,
  WorkbenchDocumentKind,
  WorkbenchEntrySliceId,
  WorkbenchProblem,
  WorkbenchProblemCode,
  WorkbenchSliceEditor,
  WorkbenchSliceId,
  WorkbenchSliceRange,
  WorkbenchUpdate,
} from "./controller";
export {
  managedEntryEdit,
  managedFrontmatterEntries,
  manifestKeyEdit,
  manifestNodeRange,
  manifestScalarSlice,
  manifestValueEdit,
} from "./manifest-patch";
export type {
  ManagedEntryAction,
  ManagedEntryLanguage,
  ManagedEntrySource,
  ManagedFrontmatterList,
  ManifestScalar,
  ManifestScalarSlice,
} from "./manifest-patch";
export { noteRegions, partialCalls, templateCalls } from "./regions";
export type {
  AnnotationRenderSite,
  ManagedBlockRegion,
  NoteRegions,
  PartialRenderSite,
} from "./regions";
export { sliceOffsets, sliceShownText, workbenchSlice } from "./slice";
export { jsonCodec, scalarCodec, sourceCodec } from "./slice-codec";
export type { SliceCodec } from "./slice-codec";

export { jsonLayout, jsonPosition } from "./json-source";
