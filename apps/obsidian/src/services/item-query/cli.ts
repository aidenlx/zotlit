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
  ITEM_QUERY_CANCEL_COMMAND,
  itemQueryCancelFlags,
  rejectionDiagnostic,
} from "./contract";
import { CLI_DATASETS } from "./datasets";
import type { CliDataset } from "./datasets";
import { decodeCancelArguments } from "./decode";
import type { QueryDatasetId } from "./worker-protocol";

export interface ItemQueryRuns {
  query(
    dataset: QueryDatasetId,
    params: CliData,
    signal: AbortSignal,
  ): Promise<string>;
  schema(
    dataset: QueryDatasetId,
    params: CliData,
    signal: AbortSignal,
  ): Promise<string>;
  /** @returns `false` when no query with this id is running. */
  cancel(id: string): boolean;
}

export function registerItemQueryCli(
  plugin: Plugin,
  runs: ItemQueryRuns,
): void {
  const unload = new AbortController();
  plugin.register(() => unload.abort());
  for (const dataset of Object.values(CLI_DATASETS)) {
    plugin.registerCliHandler(
      dataset.query.name,
      dataset.query.description,
      dataset.flags,
      (params) => runs.query(dataset.id, params, unload.signal),
    );
    plugin.registerCliHandler(
      dataset.schema.name,
      dataset.schema.description,
      null,
      (params) => runs.schema(dataset.id, params, unload.signal),
    );
    plugin.registerCliHandler(
      dataset.guide.name,
      dataset.guide.description,
      dataset.guideFlags,
      guideHandler(dataset),
    );
  }
  plugin.registerCliHandler(
    ITEM_QUERY_CANCEL_COMMAND,
    "Stop a running Item Query or Annotation Query that was started with id, and return as JSON whether one was running",
    itemQueryCancelFlags,
    createItemQueryCancelHandler((id) => runs.cancel(id)),
  );
}

/** The guide is plain text; an unknown topic answers the diagnostic envelope. */
export function guideHandler(dataset: CliDataset): (params: CliData) => string {
  return (params) => {
    const text = dataset.renderGuide(params);
    return text.kind === "invalid"
      ? failure(dataset.guide.name, rejectionDiagnostic(text))
      : text.value;
  };
}

/**
 * The cancel handler answers whether it requested the cancel of a running
 * query. An id with no running query, such as one that already finished,
 * answers `cancelRequested: false`.
 */
export function createItemQueryCancelHandler(
  cancel: (id: string) => boolean,
): CliHandler {
  return (params: CliData): string => {
    const request = decodeCancelArguments(params);
    if (request.kind === "invalid") {
      return failure(ITEM_QUERY_CANCEL_COMMAND, rejectionDiagnostic(request));
    }
    const id = request.value;
    return envelope(ITEM_QUERY_CANCEL_COMMAND, {
      ok: true,
      id,
      cancelRequested: cancel(id),
    });
  };
}
