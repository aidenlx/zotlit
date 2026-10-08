// Registers the Item Query commands with Obsidian's CLI: the only Promise edge
// of `@zotlit/item-query` (ADR 0066). The query command takes the query that
// `decode.ts` decoded from the flat arguments, resolves the Target Libraries on
// the borrowed client, runs the query, and answers the versioned envelope of
// ADR 0065. The cancel command stops one running query that the caller named
// with `id`. The schema command answers the Item Query Schema of the source in
// the same envelope; the guide command prints plain text.
//
// Command, flag, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import { Cause, Data, Effect, Exit } from "effect";
import type { CliData, CliFlag, CliFlags, CliHandler, Plugin } from "obsidian";

import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import type {
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";
import { SLICE_BUDGET_MS } from "@zotlit/item-query";
import type {
  ItemQueryError,
  ItemQuerySchema,
  QueryRow,
  QuerySummary,
} from "@zotlit/item-query";

import { getLogger } from "@/lib/log";
import { yieldToMain } from "@/lib/yield-to-main";
import { selectorKey } from "@/services/library-scope/scope";
import type {
  LibraryScope,
  LibrarySelector,
} from "@/services/library-scope/scope";
import type { WorkbenchIdentity } from "@/services/template-workbench/envelope";

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
import { invalid, rejectParameters, rejectQueryId } from "./decode";
import type { DecodedQuery } from "./decode";
import { GUIDE_TOPIC_NAMES, parseGuideTopic, renderGuide } from "./guide";
import { runDescribeItemQuery, runItemQueryTo } from "./run";
import type { ItemQueryInstrument } from "./run";

const logger = getLogger(["item-query"]);

/**
 * The wire format of the Item Query commands, versioned on its own (ADR 0065):
 * it evolves independently from the Template Contract.
 */
export const CONTRACT_VERSION = 1;

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
      rows?: readonly { indexedKey: string; values: object }[];
      file?: { path: string; bytes: number; format: "json" };
    }
  | { ok: true; identity: WorkbenchIdentity; schema: SchemaWire }
  | {
      ok: true;
      id: string;
      /** `false`: no query with this id was running in this vault. */
      cancelRequested: boolean;
    };

/** The Item Query Schema with the defaults of the CLI in place of the package's. */
type SchemaWire = Omit<ItemQuerySchema, "defaults"> & {
  defaults: Omit<ItemQuerySchema["defaults"], "limit"> & {
    limit: number;
    /** The available Libraries of the Library Scope; no argument value. */
    libraries: { source: "library-scope" };
  };
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

/** Runs inside the caller's connection scope; the caller owns the client. */
export interface ItemQueryCliDeps {
  client: NodeDatabaseClient;
  identity: WorkbenchIdentity;
  /**
   * The Library Scope in force: the default Target Libraries of a query are
   * its available Libraries.
   */
  libraryScope(): Promise<LibraryScope>;
  /** Cancels every run, such as when the plugin unloads. */
  signal: AbortSignal;
  /** Observes the engine of each query run; the measurement command sets it. */
  instrument?: ItemQueryInstrument;
  /**
   * Receives the duration of each step of the answer of a query, in
   * milliseconds; the measurement command sets it.
   */
  onAnswerStep?: (ms: number) => void;
  /** Get the job-owned output writer after validation. The caller closes it. */
  openOutput?: (path: string) => Promise<{
    write(text: string): Promise<void>;
  }>;
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
    "Query the Items of Zotero Libraries and return the matches as JSON",
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
    "Describe the fields, functions, and defaults of Item Query as JSON",
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
 * The schema handler answers the envelope for the schema and for every typed
 * failure. Cancellation and a defect reject, as in the query handler. The
 * caller rejects parameters first, with `decodeSchemaArguments`.
 */
export function createItemQuerySchemaHandler(
  deps: ItemQueryCliDeps,
): () => Promise<string> {
  return async (): Promise<string> => {
    deps.signal.throwIfAborted();

    const exit = await runDescribeItemQuery({
      client: deps.client,
      signal: deps.signal,
    });

    if (Exit.isSuccess(exit)) {
      const schema = exit.value;
      return envelope(ITEM_QUERY_SCHEMA_COMMAND, {
        ok: true,
        identity: deps.identity,
        schema: {
          ...schema,
          defaults: {
            ...schema.defaults,
            limit: DEFAULT_CLI_LIMIT,
            libraries: { source: "library-scope" },
          },
        },
      });
    }
    return answerFailure(exit.cause, ITEM_QUERY_SCHEMA_COMMAND, deps.signal);
  };
}

/** The guide is plain text; an unknown topic answers the diagnostic envelope. */
export function itemQueryGuideHandler(params: CliData): string {
  const rejected = rejectParameters(params, ["topic"]);
  if (rejected) return failure(ITEM_QUERY_GUIDE_COMMAND, rejected);
  if (params.topic === undefined) return renderGuide(null);
  const topic = parseGuideTopic(params.topic);
  if (topic === null) {
    return failure(
      ITEM_QUERY_GUIDE_COMMAND,
      invalid(
        "topic",
        `topic '${params.topic}' is not a guide topic: use ${GUIDE_TOPIC_NAMES.join(", ")}.`,
      ),
    );
  }
  return renderGuide(topic);
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
    const rejected = rejectParameters(params, ["id"]);
    if (rejected) return failure(ITEM_QUERY_CANCEL_COMMAND, rejected);
    if (params.id === undefined) {
      return failure(
        ITEM_QUERY_CANCEL_COMMAND,
        invalid(
          "id",
          "id is missing: give the id of the query to cancel, as in id=<id>.",
        ),
      );
    }
    const malformed = rejectQueryId(params.id);
    if (malformed) return failure(ITEM_QUERY_CANCEL_COMMAND, malformed);
    return envelope(ITEM_QUERY_CANCEL_COMMAND, {
      ok: true,
      id: params.id,
      cancelRequested: cancel(params.id),
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
      { details: { parameter: "id" } },
    ),
  );
}

/**
 * The handler answers the envelope of a decoded query for a result and for
 * every typed failure. It rejects with the abort reason when the run is
 * cancelled, and with an `Error` for an implementation defect.
 */
export function createItemQueryHandler(
  deps: ItemQueryCliDeps,
): (query: DecodedQuery) => Promise<string> {
  return async (decoded: DecodedQuery): Promise<string> => {
    deps.signal.throwIfAborted();

    const named = decoded.libraries;
    let scope: LibraryScope;
    if (named) scope = named.scope;
    else {
      try {
        scope = await deps.libraryScope();
      } catch (error) {
        deps.signal.throwIfAborted();
        logger.warn("Item Query could not read the Library Scope", { error });
        return failure(
          ITEM_QUERY_COMMAND,
          diagnostic(
            "source-unavailable",
            `The Library Scope of ZotLit is not readable: ${messageOf(error)}`,
          ),
        );
      }
      deps.signal.throwIfAborted();
    }
    const exit = await runItemQueryTo(
      { scope, requireEach: named !== null },
      {
        filter: decoded.filter,
        fields: decoded.fields,
        sort: decoded.sort,
        limit: decoded.limit,
      },
      {
        client: deps.client,
        signal: deps.signal,
        instrument: deps.instrument,
        begin: (summary, libraries) =>
          outputStep(() =>
            createAnswer(summary, {
              identity: deps.identity,
              libraries: libraries.available.map(({ selector, name }) =>
                selector.type === "group"
                  ? { ...selector, name: name ?? "" }
                  : selector,
              ),
              signal: deps.signal,
              onAnswerStep: deps.onAnswerStep,
              output: decoded.output,
              openOutput: deps.openOutput,
            }),
          ).pipe(
            Effect.map((answer) => ({
              write: (rows) => outputStep(() => answer.write(rows)),
              end: () => outputStep(() => answer.end()),
            })),
          ),
      },
    );

    if (Exit.isFailure(exit)) {
      return answerFailure(exit.cause, ITEM_QUERY_COMMAND, deps.signal);
    }
    const { libraries, result } = exit.value;
    if (result === null) {
      const [missing] = libraries.unavailable;
      return failure(
        ITEM_QUERY_COMMAND,
        named && missing
          ? diagnostic(
              "library-not-found",
              `The connected Zotero source holds no ${describeSelector(missing)}.`,
              { details: { parameter: named.parameter } },
            )
          : named
            ? diagnostic(
                "source-unavailable",
                "The connected Zotero source holds no Library.",
              )
            : diagnostic(
                "no-library-available",
                "The connected Zotero source holds no Library of the Library Scope.",
              ),
      );
    }
    return result;
  };
}

/** Keep cancellation observable between serialization chunks in the worker. */
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
  signal: AbortSignal;
  onAnswerStep?: (ms: number) => void;
  output?: string;
  openOutput?: ItemQueryCliDeps["openOutput"];
}

class ItemQueryOutputError extends Data.TaggedError("ItemQueryOutputError")<{
  diagnostic: Diagnostic;
}> {}

function outputFailure(error: unknown): ItemQueryOutputError | undefined {
  if (error instanceof ItemQueryOutputError) return error;
  if (error instanceof Error && "code" in error)
    return new ItemQueryOutputError({
      diagnostic: diagnostic("output-error", error.message),
    });
}

function outputStep<A>(
  step: () => Promise<A>,
): Effect.Effect<A, ItemQueryOutputError> {
  return Effect.tryPromise({ try: step, catch: (error) => error }).pipe(
    Effect.catch((error) => {
      const failed = outputFailure(error);
      return failed ? Effect.fail(failed) : Effect.die(error);
    }),
    // File acquisition/writes must settle before the job disposes its files.
    // Cancellation waits for native I/O before releasing the connection borrow.
    Effect.uninterruptible,
  );
}

/** Byte-identical pretty JSON; only the current projection chunk is retained. */
async function createAnswer(result: QuerySummary, context: AnswerContext) {
  const summary = {
    ok: true as const,
    identity: context.identity,
    libraries: context.libraries,
    request: { libraries: context.libraries.map(selectorKey), ...result.query },
    returnedCount: result.returnedCount,
    truncated: result.truncated,
  };
  const head = envelope(ITEM_QUERY_COMMAND, { ...summary, rows: [] });
  let text = "";
  let bytes = 0;
  let first = true;
  let chunkRows = FIRST_CHUNK_ROWS;
  // Open only after query validation and Library resolution succeed.
  const file =
    context.output === undefined
      ? undefined
      : await context.openOutput?.(context.output);
  if (context.output !== undefined && !file)
    throw new Error("Item Query export has no file writer");
  const append = async (chunk: string) => {
    context.signal.throwIfAborted();
    bytes += Buffer.byteLength(chunk);
    if (file) await file.write(chunk);
    else {
      if (bytes > INLINE_MAX_BYTES)
        throw new ItemQueryOutputError({
          diagnostic: diagnostic(
            "result-too-large",
            `The JSON response exceeds the inline limit of ${INLINE_MAX_BYTES} bytes.`,
          ),
        });
      text += chunk;
    }
  };
  await append(
    result.returnedCount === 0 ? head : `${head.slice(0, -NO_ROWS.length)}[`,
  );
  return {
    write: async (rows: readonly QueryRow[]) => {
      let stepMs = 0;
      for (let start = 0; start < rows.length; ) {
        context.signal.throwIfAborted();
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
        await append(part);
        if (stepMs < ANSWER_STEP_BUDGET_MS) continue;
        context.onAnswerStep?.(stepMs);
        await yieldToMain();
        context.signal.throwIfAborted();
        stepMs = 0;
      }
      context.onAnswerStep?.(stepMs);
    },
    end: async () => {
      if (result.returnedCount > 0) await append(CHUNK_END);
      if (!file) return text;
      return envelope(ITEM_QUERY_COMMAND, {
        ...summary,
        file: { path: context.output!, bytes, format: "json" },
      });
    },
  };
}

/**
 * Map the failure of one run to the answer of `command`: every typed failure
 * becomes the envelope, cancellation rejects with the abort reason, and a
 * defect rejects with an `Error`.
 */
function answerFailure(
  cause: Cause.Cause<
    | ItemQueryError
    | ItemQueryLayoutError
    | ItemQueryDatabaseError
    | ItemQueryOutputError
  >,
  command: ItemQueryCommand,
  signal: AbortSignal,
): string {
  // A masked file operation can finish with the abort reason as a defect.
  // The caller's cancelled signal remains the authority at this Promise edge.
  signal.throwIfAborted();
  const error = Cause.findErrorOption(cause);
  if (error._tag === "Some") {
    const failed = error.value;
    if (failed._tag === "ItemQueryOutputError")
      return failure(command, failed.diagnostic);
    if (failed._tag === "ItemQueryError") {
      return failure(command, {
        code: failed.code,
        message: failed.message,
        hint: failed.hint,
        location: failed.location,
      });
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
  if (Cause.hasInterruptsOnly(cause)) {
    throw (
      signal.reason ??
      new DOMException("The query was cancelled.", "AbortError")
    );
  }
  logger.error("Item Query failed with a defect", {
    cause: Cause.pretty(cause),
  });
  throw new Error("Item Query failed with an internal error.", {
    cause: Cause.squash(cause),
  });
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
