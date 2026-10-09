// The Effect-native readers of Item Query. This entry is the only one of
// `@zotlit/db` that loads `effect`.
export {
  type CandidateLeaf,
  readCandidateSet,
  readLibraryRowCount,
} from "./candidate-set";
export { type CollectionPaths, readCollectionPaths } from "./collection-paths";
export {
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  type ItemQueryReader,
  type ItemQueryReaderError,
  ItemQueryStatementObserver,
  type StatementRun,
} from "./database";
export {
  type FieldVocabulary,
  HYDRATE_CHUNK_SIZE,
  type HydratedCreator,
  type HydratedItem,
  type HydratedTag,
  type HydrateFields,
  type HydrateRelation,
  readFieldVocabulary,
  readHydrateChunk,
} from "./hydrate-chunk";
export {
  checkDatabaseLayout,
  ItemQueryLayoutError,
  type LayoutGap,
  type LayoutVersions,
} from "./layout";
export { readLibraries } from "./libraries";
export {
  readScanPage,
  readUniverseRows,
  SCAN_PAGE_SIZE,
  type ScanRow,
} from "./scan-page";

export {
  readAnnotationScanPage,
  readAnnotationRowCount,
  readAnnotationCandidateSet,
  type AnnotationCandidateLeaf,
  readAnnotationUniverseRows,
  readAnnotationHydrateChunk,
  type AnnotationScanRow,
  type AnnotationDetails,
  type HydratedAnnotation,
} from "./annotations";
