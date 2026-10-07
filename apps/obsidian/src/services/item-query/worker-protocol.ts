import type { LogRecord } from "@logtape/logtape";
import type { CliData } from "obsidian";

import type { DatabaseReadLease } from "@/services/database/service";
import type { LibraryScope } from "@/services/library-scope/scope";
import type { WorkbenchIdentity } from "@/services/template-workbench/envelope";

import type { CancellationEvent, WorkerMeasurement } from "./trace";

/** Only small request data crosses into the worker. The source lease stays in its owner. */
export interface QueryJob {
  params: CliData;
  uri: string;
  source: DatabaseReadLease["source"];
  vault: WorkbenchIdentity["vault"];
  scope: LibraryScope;
  stagePath?: string;
  measure?: boolean;
  heap?: boolean;
}

export type WorkerRequest =
  | { type: "query"; job: QueryJob }
  | { type: "cancel" };

/** JSON messages avoid Electron remote proxies and never transfer Query Rows. */
export type WorkerReply =
  | { type: "ready" }
  | { type: "cancel-accepted" }
  | { type: "cancelled" }
  | { type: "cancel-progress"; event: CancellationEvent }
  | { type: "log"; record: LogRecord }
  | { type: "answer"; answer: string; measurement?: WorkerMeasurement }
  | { type: "error"; name: string; message: string; stack?: string };
