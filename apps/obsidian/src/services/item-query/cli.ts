// Registers the commands of each CLI dataset with Obsidian's CLI (ADR 0066):
// the query and the schema command answer through the Query Jobs of the
// service, and the guide command prints plain text. The cancel command stops
// one running query that the caller named with `id`. The ZoteroReads worker
// answers each job in `answer.ts`; nothing it runs imports this module.
//
// Command, flag, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import type { CliData, CliHandler, Plugin } from "obsidian";

import {
  envelope,
  failure,
  QUERY_COMMAND,
  QUERY_SCHEMA_COMMAND,
  QUERY_GUIDE_COMMAND,
  QUERY_CANCEL_COMMAND,
  queryFlags,
  queryCancelFlags,
  rejectionDiagnostic,
} from "./contract";
import { decodeCancelArguments, decodeGuideArguments } from "./decode";
import { GUIDE_TOPIC_NAMES, renderGuide } from "./guide";

export interface QueryRuns {
  query(params: CliData, signal: AbortSignal): Promise<string>;
  schema(params: CliData, signal: AbortSignal): Promise<string>;
  cancel(id: string): boolean;
}

export function registerQueryCli(plugin: Plugin, runs: QueryRuns): void {
  const unload = new AbortController();
  plugin.register(() => unload.abort());
  plugin.registerCliHandler(
    QUERY_COMMAND,
    "Query Zotero items and annotations as JSON; read zotlit:query-guide for syntax and zotlit:query-schema for the field catalog",
    queryFlags,
    (params) => runs.query(params, unload.signal),
  );
  plugin.registerCliHandler(
    QUERY_SCHEMA_COMMAND,
    "Get the version-pinned schema download, source custom fields, and CLI defaults as JSON",
    { from: queryFlags.from },
    (params) => runs.schema(params, unload.signal),
  );
  plugin.registerCliHandler(
    QUERY_GUIDE_COMMAND,
    "Print the ZotLit Query guide",
    {
      topic: {
        value: `<${GUIDE_TOPIC_NAMES.join("|")}>`,
        description: "Guide topic; omit it for the whole guide",
      },
    },
    guideHandler,
  );
  plugin.registerCliHandler(
    QUERY_CANCEL_COMMAND,
    "Stop a running query started with id, and return as JSON whether one was running",
    queryCancelFlags,
    createQueryCancelHandler((id) => runs.cancel(id)),
  );
}

/** The guide is plain text; an unknown topic answers the diagnostic envelope. */
export function guideHandler(params: CliData): string {
  const topic = decodeGuideArguments(params);
  return topic.kind === "invalid"
    ? failure(QUERY_GUIDE_COMMAND, rejectionDiagnostic(topic))
    : renderGuide(topic.value);
}

/**
 * The cancel handler answers whether it requested the cancel of a running
 * query. An id with no running query, such as one that already finished,
 * answers `cancelRequested: false`.
 */
export function createQueryCancelHandler(
  cancel: (id: string) => boolean,
): CliHandler {
  return (params: CliData): string => {
    const request = decodeCancelArguments(params);
    if (request.kind === "invalid") {
      return failure(QUERY_CANCEL_COMMAND, rejectionDiagnostic(request));
    }
    const id = request.value;
    return envelope(QUERY_CANCEL_COMMAND, {
      ok: true,
      id,
      cancelRequested: cancel(id),
    });
  };
}
