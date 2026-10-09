export {
  type FilterType,
  type ItemQuerySchema,
  type JsonType,
  type SchemaCapabilities,
  type SchemaCustomField,
  type SchemaField,
  type SchemaFunction,
  type SchemaMethod,
  type SchemaParameter,
  type SchemaProperty,
} from "./describe-item-query";
export { describeItemQueryCustomFields } from "./describe-item-query-custom-fields";
export {
  ItemQueryError,
  type ItemQueryErrorCode,
  type ItemQueryErrorLocation,
} from "./error";
export { DEFAULT_FIELDS } from "./fields";
// The typed database failures of `queryItems`, `consumeQueryItems`, and
// `describeItemQueryCustomFields`, from the readers of `@zotlit/db/item-query`.
export {
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";
export { QueryTimeZone } from "./query-clock";
export {
  queryItems,
  consumeQueryItems,
  type QueryConsumer,
  type QuerySummary,
} from "./query-items";
export { DEFAULT_SORT, COUNT_FIELDS, UNLIMITED_LIMIT } from "./request";
export type {
  ItemQuery,
  ItemQueryRequest,
  ProjectionValue,
  QueryResult,
  QueryRow,
  SortSpec,
  TargetLibrary,
} from "./request";
export {
  ItemQueryScheduler,
  ItemQuerySliceObserver,
  SLICE_BUDGET_MS,
  type SliceObserver,
} from "./scheduler";

export {
  queryAnnotations,
  consumeQueryAnnotations,
  DEFAULT_ANNOTATION_SORT,
  type AnnotationQueryRequest,
  type AnnotationQueryOptions,
} from "./query-annotations";
export { DEFAULT_ANNOTATION_FIELDS } from "./annotation-fields";

export { describeAnnotationQueryCustomFields } from "./describe-item-query-custom-fields";
export {
  diagnose,
  diagnoseDecode,
  renderDiagnostic,
  type Diagnostic,
  type DiagnosticLocation,
} from "./diagnose";
export type {
  Fault,
  ItemQueryFault,
  PlainFault,
  Span,
  Role,
  Receiver,
  Callee,
  SyntaxFault,
} from "./fault";
