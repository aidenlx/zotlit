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
export { describeQueryCustomFields } from "./describe-query-custom-fields";
export {
  AttachmentFileResolver,
  type QueryDataset,
  type ResolveAttachmentFile,
} from "./dataset";
export { ITEMS } from "./query-items";
export { ANNOTATIONS } from "./query-annotations";
export {
  ItemQueryError,
  type ItemQueryErrorCode,
  type ItemQueryErrorLocation,
} from "./error";
// The typed database failures of `collectQuery`, `consumeQuery`, and
// `describeQueryCustomFields`, from the readers of `@zotlit/db/item-query`.
export {
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";
export { QueryTimeZone } from "./query-clock";
export {
  collectQuery,
  consumeQuery,
  type QueryConsumer,
  type QuerySummary,
} from "./query";
export { COUNT_FIELDS, UNLIMITED_LIMIT } from "./request";
export type {
  ItemQuery,
  ItemQueryRequest,
  ProjectionValue,
  QueryResult,
  QueryGroup,
  GroupValue,
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
