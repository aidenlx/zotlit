export { ANNOTATION_HEADER } from "@zotlit/templates/constants";

export {
  entryPosition,
  entrySlice,
  sliceEdit,
  WorkbenchDocumentController,
} from "./controller";
export type {
  WorkbenchAnnotationSection,
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
} from "./manifest-patch";
export { noteRegions } from "./regions";
export type {
  AnnotationRenderSite,
  ManagedBlockRegion,
  NoteRegions,
} from "./regions";
export { workbenchSlice } from "./slice";
