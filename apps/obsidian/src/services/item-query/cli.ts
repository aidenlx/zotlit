// Registers the Item Query commands with Obsidian's CLI (ADR 0066), and answers
// the versioned envelope of ADR 0065 for one Query Job. The query answer takes
// the query that `decode.ts` decoded from the flat arguments, resolves the
// Target Libraries on the database of the job, runs the query, and encodes the
// envelope. The cancel command stops one running query that the caller named
// with `id`. The schema command answers the Item Query Schema of the source in
// the same envelope; the guide command prints plain text.
//
// Command, flag, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import { Cause, Data, Effect } from "effect";
import type { Scope } from "effect";
import type { CliData, CliFlag, CliFlags, CliHandler, Plugin } from "obsidian";

import type {
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";
import {
  diagnose,
  DEFAULT_FIELDS,
  DEFAULT_SORT,
  describeItemQueryCustomFields,
  SLICE_BUDGET_MS,
} from "@zotlit/item-query";
import type {
  ItemQueryError,
  SchemaCustomField,
  QueryRow,
  QuerySummary,
} from "@zotlit/item-query";

import { resourceReleaseUrl } from "@/lib/constants";
import { getLogger } from "@/lib/log";
import { selectorKey } from "@/services/library-scope/scope";
import type {
  LibraryScope,
  LibrarySelector,
} from "@/services/library-scope/scope";
import type { WorkbenchIdentity } from "@/services/template-workbench/envelope";
import type { SchemaAsset } from "@/services/template-workbench/schema";

import {
  DEFAULT_CLI_LIMIT,
  diagnostic,
  ITEM_QUERY_CANCEL_COMMAND,
  ITEM_QUERY_COMMAND,
  INLINE_MAX_BYTES,
  ITEM_QUERY_GUIDE_COMMAND,
  ITEM_QUERY_SCHEMA_COMMAND,
  itemQueryCancelFlags,
  itemQueryFlags,
} from "./contract";
import type { Diagnostic, ItemQueryCommand } from "./contract";
import contractVersion from "./contract-version.json" with { type: "json" };
import {
  decodeCancelArguments,
  decodeGuideArguments,
  rejectionDiagnostic,
} from "./decode";
import type { DecodedQuery, NamedLibraries } from "./decode";
import { GUIDE_TOPIC_NAMES, renderGuide } from "./guide";
import { runItemQueryTo } from "./run";
import type { ItemQueryInstrument, TargetLibrariesUnavailable } from "./run";
import type { QueryReply } from "./worker-protocol";

const logger = getLogger(["item-query"]);

/**
 * The wire format of the Item Query commands, versioned on its own (ADR 0065):
 * it evolves independently from the Template Contract.
 */
export const CONTRACT_VERSION = contractVersion.contractVersion;

export {
  DEFAULT_CLI_LIMIT,
  diagnostic,
  ITEM_QUERY_CANCEL_COMMAND,
  ITEM_QUERY_COMMAND,
  ITEM_QUERY_GUIDE_COMMAND,
  ITEM_QUERY_SCHEMA_COMMAND,
  itemQueryFlags,
};

export const itemQueryGuideFlags: CliFlags = {
  topic: {
    value: `<${GUIDE_TOPIC_NAMES.join("|")}>`,
    description: "Guide topic; omit it for the quickstart",
  },
} satisfies Record<"topic", CliFlag>;

/** A Target Library on the wire: local `libraryID` values stay inside. */
type LibraryWire =
  | { type: "personal" }
  | { type: "group"; groupID: number; name: string };

type EnvelopeTail =
  | { ok: false; diagnostic: Diagnostic }
  | {
      ok: true;
      identity: WorkbenchIdentity;
      libraries: readonly LibraryWire[];
      request: object;
      returnedCount: number;
      truncated: boolean;
      warnings: QuerySummary["warnings"];
      rows?: readonly { indexedKey: string; values: object }[];
      file?: { path: string; bytes: number; format: "json" };
    }
  | {
      ok: true;
      identity: WorkbenchIdentity;
      schema: SchemaAsset;
      customFields: readonly SchemaCustomField[];
      defaults: {
        fields: readonly string[];
        sort: typeof DEFAULT_SORT;
        limit: number;
        libraries: { source: "library-scope" };
      };
    }
  | {
      ok: true;
      id: string;
      /** `false`: no query with this id was running in this vault. */
      cancelRequested: boolean;
    };

function envelope(command: ItemQueryCommand, tail: EnvelopeTail): string {
  return JSON.stringify(
    { contractVersion: CONTRACT_VERSION, command, ...tail },
    null,
    2,
  );
}

export function failure(
  command: ItemQueryCommand,
  diagnostic: Diagnostic,
): string {
  return envelope(command, { ok: false, diagnostic });
}

/** The parameters of one query or schema answer inside a Query Job. */
export interface ItemQueryCliDeps {
  identity: WorkbenchIdentity;
  /**
   * The Library Scope in force: the default Target Libraries of a query are
   * its available Libraries.
   */
  scope: LibraryScope;
  /** Observes the engine of each query run; the measurement command sets it. */
  instrument?: ItemQueryInstrument;
  /**
   * Receives the duration of each step of the answer of a query, in
   * milliseconds; the measurement command sets it.
   */
  onAnswerStep?: (ms: number) => void;
  /**
   * Opens the job-owned output writer after validation. The scope of the job
   * closes it.
   */
  openOutput?: (
    path: string,
  ) => Effect.Effect<QueryWriter, ItemQueryOutputError, Scope.Scope>;
}

/** The output file of an export: each write finishes before the next. */
export interface QueryWriter {
  write(text: string): Effect.Effect<void, ItemQueryOutputError>;
}

export interface ItemQueryRuns {
  answer(params: CliData, signal: AbortSignal): Promise<string>;
  /** @returns `false` when no query with this id is running. */
  cancel(id: string): boolean;
  schema(params: CliData, signal: AbortSignal): Promise<string>;
}

export function registerItemQueryCli(
  plugin: Plugin,
  runs: ItemQueryRuns,
): void {
  const unload = new AbortController();
  plugin.register(() => unload.abort());
  plugin.registerCliHandler(
    ITEM_QUERY_COMMAND,
    "Query Zotero Items as JSON; read zotlit:item-query-guide for syntax and zotlit:item-query-schema for the published field catalog",
    itemQueryFlags,
    (params) => runs.answer(params, unload.signal),
  );
  plugin.registerCliHandler(
    ITEM_QUERY_CANCEL_COMMAND,
    "Stop a running Item Query that was started with id, and return as JSON whether one was running",
    itemQueryCancelFlags,
    createItemQueryCancelHandler((id) => runs.cancel(id)),
  );
  plugin.registerCliHandler(
    ITEM_QUERY_SCHEMA_COMMAND,
    "Get the version-pinned schema download, source custom fields, and CLI defaults as JSON",
    null,
    (params) => runs.schema(params, unload.signal),
  );
  plugin.registerCliHandler(
    ITEM_QUERY_GUIDE_COMMAND,
    "Print the ZotLit Item Query guide",
    itemQueryGuideFlags,
    itemQueryGuideHandler,
  );
}

/**
 * The schema answer is the envelope for the schema and for every typed
 * failure. Cancellation interrupts it, and a defect dies, as in the query
 * answer. The caller rejects parameters first, with `decodeSchemaArguments`.
 */
export function answerItemQuerySchema(
  deps: Pick<ItemQueryCliDeps, "identity">,
  pluginVersion: string,
): Effect.Effect<QueryReply, never, ItemQueryDatabase> {
  return describeItemQueryCustomFields().pipe(
    Effect.map((customFields) =>
      inline(
        envelope(ITEM_QUERY_SCHEMA_COMMAND, {
          ok: true,
          identity: deps.identity,
          schema: {
            url: `${resourceReleaseUrl(pluginVersion)}/item-query.schema.json`,
            fileName: `zotlit-item-query-${pluginVersion}.schema.json`,
          },
          customFields,
          defaults: {
            fields: DEFAULT_FIELDS,
            sort: DEFAULT_SORT,
            limit: DEFAULT_CLI_LIMIT,
            libraries: { source: "library-scope" },
          },
        }),
      ),
    ),
    answerFailure(ITEM_QUERY_SCHEMA_COMMAND),
  );
}

/** The guide is plain text; an unknown topic answers the diagnostic envelope. */
export function itemQueryGuideHandler(params: CliData): string {
  const topic = decodeGuideArguments(params);
  if (topic.kind === "invalid") {
    return failure(ITEM_QUERY_GUIDE_COMMAND, rejectionDiagnostic(topic));
  }
  return renderGuide(topic.value);
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

/** The answer of a query whose id names a query that is still running. */
export function queryIdInUseFailure(id: string): string {
  return failure(
    ITEM_QUERY_COMMAND,
    diagnostic(
      "query-id-in-use",
      `A query with the id '${id}' is running in this vault.`,
      { parameter: "id" },
    ),
  );
}

/**
 * The answer of a decoded query is the envelope for a result and for every
 * typed failure. Cancellation interrupts it, and an implementation defect dies
 * with an `Error`.
 */
export function answerItemQuery(
  deps: ItemQueryCliDeps,
  decoded: DecodedQuery,
): Effect.Effect<QueryReply, never, ItemQueryDatabase | Scope.Scope> {
  const named = decoded.libraries;
  const operation = runItemQueryTo(
    { scope: named ? named.scope : deps.scope, requireEach: named !== null },
    {
      filter: decoded.filter,
      fields: decoded.fields,
      sort: decoded.sort,
      limit: decoded.limit,
    },
    (summary, libraries) =>
      createAnswer(summary, {
        identity: deps.identity,
        libraries: libraries.available.map(({ selector, name }) =>
          selector.type === "group"
            ? { ...selector, name: name ?? "" }
            : selector,
        ),
        onAnswerStep: deps.onAnswerStep,
        output: decoded.output,
        openOutput: deps.openOutput,
      }),
  );
  return (deps.instrument?.(operation) ?? operation).pipe(
    answerFailure(ITEM_QUERY_COMMAND, named?.parameter, decoded.filter),
  );
}

const inline = (answer: string): QueryReply => ({
  answer,
  receipt: { kind: "inline" },
});

/** The time of one step of the answer that `onAnswerStep` reports. */
const ANSWER_STEP_BUDGET_MS = SLICE_BUDGET_MS / 2;
const NO_ROWS = "[]\n}";
const CHUNK_START = '{\n  "rows": [';
const CHUNK_END = "\n  ]\n}";
const FIRST_CHUNK_ROWS = 64;
const CHUNK_TEXT_LENGTH = 256 * 1024;

interface AnswerContext {
  /** The identity of the source the run leased. */
  identity: WorkbenchIdentity;
  /** The Target Libraries of the run, in the canonical order. */
  libraries: readonly LibraryWire[];
  onAnswerStep?: (ms: number) => void;
  output?: string;
  openOutput?: ItemQueryCliDeps["openOutput"];
}

/** The output of the answer failed: the envelope carries `diagnostic`. */
export class ItemQueryOutputError extends Data.TaggedError(
  "ItemQueryOutputError",
)<{
  diagnostic: Diagnostic;
}> {}

/**
 * Byte-identical pretty JSON; only the current projection chunk is retained.
 * Each chunk is one step of the job fiber, so the scheduler of the job can end
 * a slice and an interrupt can land between two chunks.
 */
const createAnswer = Effect.fnUntraced(function* (
  result: QuerySummary,
  context: AnswerContext,
) {
  const summary = {
    ok: true as const,
    identity: context.identity,
    libraries: context.libraries,
    request: { libraries: context.libraries.map(selectorKey), ...result.query },
    returnedCount: result.returnedCount,
    truncated: result.truncated,
    warnings: result.warnings,
  };
  const head = envelope(ITEM_QUERY_COMMAND, { ...summary, rows: [] });
  let text = "";
  let bytes = 0;
  let first = true;
  let chunkRows = FIRST_CHUNK_ROWS;
  // Open only after query validation and Library resolution succeed.
  const { output, openOutput } = context;
  let file: QueryWriter | undefined;
  if (output !== undefined) {
    if (!openOutput)
      return yield* Effect.die(
        new Error("Item Query export has no file writer"),
      );
    file = yield* openOutput(output);
  }
  const append = (chunk: string) =>
    Effect.suspend(() => {
      bytes += Buffer.byteLength(chunk);
      if (file) return file.write(chunk);
      if (bytes > INLINE_MAX_BYTES)
        return Effect.fail(
          new ItemQueryOutputError({
            diagnostic: diagnostic(
              "result-too-large",
              `The JSON response exceeds the inline limit of ${INLINE_MAX_BYTES} bytes.`,
            ),
          }),
        );
      text += chunk;
      return Effect.void;
    });
  yield* append(
    result.returnedCount === 0 ? head : `${head.slice(0, -NO_ROWS.length)}[`,
  );
  return {
    write: Effect.fnUntraced(function* (rows: readonly QueryRow[]) {
      let stepMs = 0;
      for (let start = 0; start < rows.length; ) {
        const stepStart = performance.now();
        const chunk = rows.slice(start, start + chunkRows);
        const wire = JSON.stringify({ rows: chunk }, null, 2).slice(
          CHUNK_START.length,
          -CHUNK_END.length,
        );
        const part = first ? wire : `,${wire}`;
        first = false;
        start += chunk.length;
        chunkRows = Math.max(
          1,
          Math.ceil(CHUNK_TEXT_LENGTH / (wire.length / chunk.length)),
        );
        stepMs += performance.now() - stepStart;
        yield* append(part);
        if (stepMs < ANSWER_STEP_BUDGET_MS) continue;
        context.onAnswerStep?.(stepMs);
        stepMs = 0;
      }
      context.onAnswerStep?.(stepMs);
    }),
    end: Effect.fnUntraced(function* () {
      if (result.returnedCount > 0) yield* append(CHUNK_END);
      if (output === undefined) return inline(text);
      return {
        answer: envelope(ITEM_QUERY_COMMAND, {
          ...summary,
          file: { path: output, bytes, format: "json" },
        }),
        receipt: { kind: "file", path: output, bytes },
      } satisfies QueryReply;
    }),
  };
});

/**
 * Map the failure of one run to the answer of `command`: every typed failure
 * becomes the envelope, and a defect dies with an `Error`. Cancellation stays
 * an interruption.
 */
function answerFailure(
  command: ItemQueryCommand,
  /** The argument that named the Target Libraries, if the caller named them. */
  parameter?: NamedLibraries["parameter"],
  filter = "",
) {
  return <R>(
    run: Effect.Effect<
      QueryReply,
      | ItemQueryError
      | ItemQueryLayoutError
      | ItemQueryDatabaseError
      | ItemQueryOutputError
      | TargetLibrariesUnavailable,
      R
    >,
  ): Effect.Effect<QueryReply, never, R> =>
    run.pipe(
      Effect.catch((failed) =>
        Effect.sync(() =>
          inline(failureText(failed, command, { parameter, filter })),
        ),
      ),
      Effect.catchDefect((defect) => {
        logger.error("Item Query failed with a defect", {
          cause: Cause.pretty(Cause.die(defect)),
        });
        return Effect.die(
          new Error("Item Query failed with an internal error.", {
            cause: defect,
          }),
        );
      }),
    );
}

function failureText(
  failed:
    | ItemQueryError
    | ItemQueryLayoutError
    | ItemQueryDatabaseError
    | ItemQueryOutputError
    | TargetLibrariesUnavailable,
  command: ItemQueryCommand,
  {
    parameter,
    filter,
  }: { parameter: NamedLibraries["parameter"] | undefined; filter: string },
): string {
  if (failed._tag === "ItemQueryOutputError")
    return failure(command, failed.diagnostic);
  if (failed._tag === "TargetLibrariesUnavailable") {
    return failure(command, targetLibrariesFailure(failed, parameter));
  }
  if (failed._tag === "ItemQueryError") {
    return failure(
      command,
      diagnose(failed.fault, failed.argumentText ?? filter, failed.location),
    );
  }
  if (failed._tag === "ItemQueryLayoutError") {
    // `@zotlit/db` logs the missing layout and the versions once per copy.
    return failure(
      command,
      diagnostic("unsupported-database-layout", failed.message),
    );
  }
  return databaseFailure(command, failed.cause, { logged: failed });
}

/** The diagnostic of a run that has no Target Library. */
function targetLibrariesFailure(
  { reason, missing }: TargetLibrariesUnavailable,
  parameter: NamedLibraries["parameter"] | undefined,
): Diagnostic {
  if (reason === "named-missing" && missing) {
    return diagnostic(
      "library-not-found",
      `The connected Zotero source holds no ${describeSelector(missing)}.`,
      parameter && { parameter },
    );
  }
  if (reason === "named-none") {
    return diagnostic(
      "source-unavailable",
      "The connected Zotero source holds no Library.",
    );
  }
  return diagnostic(
    "no-library-available",
    "The connected Zotero source holds no Library of the Library Scope.",
  );
}

function databaseFailure(
  command: ItemQueryCommand,
  cause: unknown,
  options: {
    /** @default cause */
    logged?: unknown;
  } = {},
): string {
  logger.error("Item Query failed to read the Zotero database", {
    error: options.logged ?? cause,
  });
  return failure(
    command,
    diagnostic(
      "database-error",
      `Item Query could not read the Zotero database: ${messageOf(cause)}`,
    ),
  );
}

function describeSelector(selector: LibrarySelector): string {
  return selector.type === "group"
    ? `group Library with the group ID ${selector.groupID}`
    : "personal Library";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
