import type { CliData } from "obsidian";

import type { LibraryScope } from "@/services/library-scope/scope";
import type { WorkbenchIdentity } from "@/services/template-workbench/envelope";

/** Small request data for the ZoteroReads worker. Query rows stay in that worker. */
export interface QueryJob {
  id: string;
  params: CliData;
  source: WorkbenchIdentity["source"];
  vault: WorkbenchIdentity["vault"];
  scope: LibraryScope;
  schema?: boolean;
  stagePath?: string;
  measure?: boolean;
  heap?: boolean;
}
