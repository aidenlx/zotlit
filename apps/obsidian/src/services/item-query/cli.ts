// Registers the commands of each CLI dataset with Obsidian's CLI (ADR 0066):
// the query and the schema command answer through the Query Jobs of the
// service, and the guide command prints plain text. The cancel command stops
// one running query that the caller named with `id`. The ZoteroReads worker
// answers each job in `answer.ts`; nothing it runs imports this module.
//
// Command, flag, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import { Effect, Layer } from "effect";
import type { CliData } from "obsidian";

import type { CliCommandHandler, CliHost } from "@/lib/cli-command";
import { catchRejection } from "@/lib/cli-params";
import { PluginHost } from "@/lib/plugin-host";

import {
  envelope,
  failure,
  QUERY_COMMAND,
  QUERY_SCHEMA_COMMAND,
  QUERY_VALUES_COMMAND,
  queryValuesFlags,
  QUERY_GUIDE_COMMAND,
  QUERY_CANCEL_COMMAND,
  queryFlags,
  queryCancelFlags,
  rejectionDiagnostic,
} from "./contract";
import type { QueryCliCommand } from "./contract";
import { decodeCancelArguments, decodeGuideArguments } from "./decode";
import { GUIDE_TOPIC_NAMES, renderGuide } from "./guide";
import { QueryService } from "./service";
import type { ItemQueryError, QueryCancelled } from "./service";

/** The runs of the service; interrupting a handler interrupts its run. */
export type QueryRuns = Pick<
  QueryService["Service"],
  "query" | "values" | "schema" | "cancel"
>;

/** The `zotlit:query*` commands, over the plugin's ZotLit Query. */
export const layerQueryCli: Layer.Layer<
  never,
  never,
  PluginHost | QueryService
> = Layer.effectDiscard(
  Effect.gen(function* () {
    registerQueryCli(yield* PluginHost, yield* QueryService);
  }),
);

export function registerQueryCli(host: CliHost, runs: QueryRuns): void {
  host.registerCliCommand(QUERY_COMMAND, {
    description:
      "Query Zotero items and annotations as JSON; read zotlit:query-guide for syntax and zotlit:query-schema for the field catalog",
    flags: queryFlags,
    handler: runHandler("QueryCli.query", (params) => runs.query(params)),
  });
  host.registerCliCommand(QUERY_SCHEMA_COMMAND, {
    description:
      "Get the version-pinned schema download, source custom fields, and CLI defaults as JSON",
    flags: { from: queryFlags.from },
    handler: runHandler("QueryCli.schema", (params) => runs.schema(params)),
  });
  host.registerCliCommand(QUERY_VALUES_COMMAND, {
    description:
      "List exact Collection paths or Tag names per Library before writing a filter",
    flags: queryValuesFlags,
    handler: runHandler("QueryCli.values", (params) => runs.values(params)),
  });
  host.registerCliCommand(QUERY_GUIDE_COMMAND, {
    description:
      "Print the guide for zotlit:query, zotlit:query-values, zotlit:query-schema, and zotlit:query-cancel",
    flags: {
      topic: {
        value: `<${GUIDE_TOPIC_NAMES.join("|")}>`,
        description: "Guide topic; omit it for the whole guide",
      },
    },
    handler: guideHandler,
  });
  host.registerCliCommand(QUERY_CANCEL_COMMAND, {
    description:
      "Stop a running query started with id, and return as JSON whether one was running",
    flags: queryCancelFlags,
    handler: createQueryCancelHandler((id) => runs.cancel(id)),
  });
}

/**
 * A handler over one run of the service. A cancel by `zotlit:query-cancel` is
 * the handler's failure, whose message Obsidian prints; interrupting the
 * handler interrupts the run.
 */
function runHandler(
  name: string,
  run: (
    params: CliData,
  ) => Effect.Effect<string, QueryCancelled | ItemQueryError>,
): CliCommandHandler {
  return Effect.fn(name)((params: CliData) => run(params));
}

/** A rejected request answers the diagnostic envelope of `command`. */
const answerRejection = (command: QueryCliCommand) =>
  catchRejection((rejected) => failure(command, rejectionDiagnostic(rejected)));

/** The guide is plain text; an unknown topic answers the diagnostic envelope. */
export const guideHandler: CliCommandHandler = (params) =>
  decodeGuideArguments(params).pipe(
    Effect.map((topic) => renderGuide(topic)),
    answerRejection(QUERY_GUIDE_COMMAND),
  );

/**
 * The cancel handler answers whether it requested the cancel of a running
 * query. An id with no running query, such as one that already finished,
 * answers `cancelRequested: false`.
 */
export function createQueryCancelHandler(
  cancel: (id: string) => Effect.Effect<boolean>,
): CliCommandHandler {
  return Effect.fn("QueryCli.cancel")(function* (params: CliData) {
    const id = yield* decodeCancelArguments(params);
    return envelope(QUERY_CANCEL_COMMAND, {
      ok: true,
      id,
      cancelRequested: yield* cancel(id),
    });
  }, answerRejection(QUERY_CANCEL_COMMAND));
}
