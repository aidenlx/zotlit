import type { LibraryScope } from "@/services/library-scope/scope";
import type { WorkbenchIdentity } from "@/services/template-workbench/envelope";

import type { DecodedQuery } from "./decode";

/** The command of a job: the schema, or the query that the renderer decoded. */
export type QueryCommand =
  | { schema: true }
  | { schema: false; query: DecodedQuery };

/** Small request data for the ZoteroReads worker. Query rows stay in that worker. */
export type QueryJob = QueryCommand & {
  id: string;
  source: WorkbenchIdentity["source"];
  vault: WorkbenchIdentity["vault"];
  scope: LibraryScope;
  stagePath?: string;
  measure?: boolean;
  heap?: boolean;
};
