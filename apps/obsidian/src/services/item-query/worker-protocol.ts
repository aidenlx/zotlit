import type { AttachmentPathContext } from "@zotlit/db/path";
import type { QueryDataset } from "@zotlit/item-query";

import type { LibraryScope } from "@/services/library-scope/scope";
import type { WorkbenchIdentity } from "@/services/template-workbench/envelope";

import type { QUERY_COMMAND, QueryCliCommand } from "./contract";
import type { DecodedQuery, DecodedValues } from "./decode";
import type { QueryViewOutcome, QueryViewRequest } from "./query-view";
import type { WorkerMeasurement } from "./trace";

/** The Query Dataset that a job reads: Items or Annotations. */
export type QueryDatasetId = QueryDataset["id"];

/**
 * The command of a job: the schema, or the query that the renderer decoded,
 * of one Query Dataset. `command` is the CLI command that the envelope names.
 */
export type QueryCommand = {
  command: QueryCliCommand;
} & (
  | { schema: true; pluginVersion: string; dataset?: QueryDatasetId }
  | { schema: false; values: DecodedValues; dataset?: never; query?: never }
  | { schema: false; query: DecodedQuery; dataset: QueryDatasetId }
);

/** The typed query of a Query View; its answer is data, not envelope text. */
export interface QueryViewCommand {
  command: typeof QUERY_COMMAND;
  schema: false;
  view: QueryViewRequest;
}

/** Small request data for the ZoteroReads worker. Query rows stay in that worker. */
export type QueryJob = (QueryCommand | QueryViewCommand) & {
  id: string;
  source: WorkbenchIdentity["source"];
  vault: WorkbenchIdentity["vault"];
  scope: LibraryScope;
  uses?: Readonly<Record<string, number>>;
  attachmentPaths: AttachmentPathContext;
  stagePath?: string;
  measure?: boolean;
  heap?: boolean;
};

/**
 * Where the result of a job is: in `answer` itself, or in the staging file
 * that the worker closed. The renderer publishes a `file` receipt.
 */
export type QueryReceipt =
  | { kind: "inline" }
  | { kind: "file"; path: string; bytes: number };

/** The envelope text of a job, with its command and receipt. */
export interface QueryReply {
  command: QueryCliCommand;
  answer: string;
  receipt: QueryReceipt;
}

/** The answer to a typed query: the outcome as data; `answer` is empty. */
export interface QueryViewReply extends QueryReply {
  view: Exclude<QueryViewOutcome, { kind: "cancelled" }>;
}

/** The answer of the worker to one job. */
export interface QueryAnswer extends QueryReply {
  /** `CancelItemQuery` interrupted the job; `answer` is empty. */
  cancelled?: true;
  /** The outcome of a typed query; `answer` is empty. */
  view?: QueryViewReply["view"];
  measurement?: WorkerMeasurement;
}
