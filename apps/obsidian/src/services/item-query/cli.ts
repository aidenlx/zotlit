// Registers the Item Query commands with Obsidian's CLI: the only Promise edge
// of `@zotlit/item-query` (ADR 0066). The query command decodes the flat
// arguments, takes the source lease, resolves the Target Libraries, runs the
// query, and answers the versioned envelope of ADR 0065. The cancel command
// stops one running query that the caller named with `id`. The schema command
// answers the Item Query Schema of the source in the same envelope; the guide
// command prints plain text.
//
// Command, flag, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import { regex } from "arkregex";
import { Cause, Data, Effect, Exit } from "effect";
import { isAbsolute } from "node:path";
import type { CliData, CliFlag, CliFlags, CliHandler, Plugin } from "obsidian";
import * as v from "valibot";

import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import type {
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";
import { SLICE_BUDGET_MS } from "@zotlit/item-query";
import type {
  ItemQueryError,
  ItemQuerySchema,
  QueryResult,
  QueryRow,
  QuerySummary,
  SortSpec,
} from "@zotlit/item-query";

import { getLogger } from "@/lib/log";
import { yieldToMain } from "@/lib/yield-to-main";
import { compareSelectors, selectorKey } from "@/services/library-scope/scope";
import type {
  LibraryScope,
  LibrarySelector,
} from "@/services/library-scope/scope";
import type { WorkbenchIdentity } from "@/services/template-workbench/envelope";

import {
  DEFAULT_CLI_LIMIT,
  DIAGNOSTIC_HINTS,
  ITEM_QUERY_CANCEL_COMMAND,
  ITEM_QUERY_COMMAND,
  INLINE_MAX_BYTES,
  ITEM_QUERY_GUIDE_COMMAND,
  ITEM_QUERY_PARAMS,
  ITEM_QUERY_SCHEMA_COMMAND,
  itemQueryCancelFlags,
  itemQueryFlags,
  QUERY_ID_FORM,
  QUERY_ID_MAX_LENGTH,
} from "./contract";
import type { ItemQueryCommand } from "./contract";
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

type AdapterDiagnosticCode = keyof typeof DIAGNOSTIC_HINTS;

interface Diagnostic {
  code: AdapterDiagnosticCode | ItemQueryError["code"];
  message: string;
  hint: string;
  /** Where an invalid query went wrong. */
  location?: ItemQueryError["location"];
  details?: { parameter: string };
}

export function diagnostic(
  code: AdapterDiagnosticCode,
  message: string,
  options: { details?: Diagnostic["details"] } = {},
): Diagnostic {
  return {
    code,
    message,
    hint: DIAGNOSTIC_HINTS[code],
    details: options.details,
  };
}

/** A Target Library on the wire: local `libraryID` values stay inside. */
type LibraryWire =
  | { type: "personal" }
  | { type: "group"; groupID: number; name: string };

/** The Libraries the caller names, as a scope that needs each of them. */
interface NamedLibraries {
  scope: LibraryScope;
  /** The argument that names them. */
  parameter: "library" | "libraries";
}

/** The flat arguments after decoding. */
interface DecodedArguments {
  /** `null`: the Library Scope in force decides. */
  libraries: NamedLibraries | null;
  filter: string | undefined;
  fields: readonly string[] | undefined;
  sort: readonly SortSpec[] | undefined;
  limit: number | null;
  output: string | undefined;
}

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

/** A pinned read of the active Zotero source, released on dispose. */
export interface ItemQueryLease extends Disposable {
  readonly client: NodeDatabaseClient;
  readonly source: WorkbenchIdentity["source"];
}

export interface ItemQueryCliDeps {
  acquireRead(): Promise<ItemQueryLease>;
  vault(): WorkbenchIdentity["vault"];
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
  /** Open an unpublished file owned by the job; close on failure or disposal too. */
  openOutput?: (path: string) => Promise<{
    write(text: string): Promise<void>;
    close(): Promise<void>;
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
 * failure. Cancellation and a defect reject, as in the query handler.
 */
export function createItemQuerySchemaHandler(
  deps: ItemQueryCliDeps,
): CliHandler {
  return async (params: CliData): Promise<string> => {
    const rejected = rejectParameters(params, []);
    if (rejected) return failure(ITEM_QUERY_SCHEMA_COMMAND, rejected);

    deps.signal.throwIfAborted();

    const read = await withLease(deps, ITEM_QUERY_SCHEMA_COMMAND, (client) =>
      runDescribeItemQuery({ client, signal: deps.signal }),
    );
    if ("answer" in read) return read.answer;
    const exit = read.value;

    if (Exit.isSuccess(exit)) {
      const schema = exit.value;
      return envelope(ITEM_QUERY_SCHEMA_COMMAND, {
        ok: true,
        identity: read.identity,
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

/** Reject malformed CLI parameters before the host acquires a database lease. */
export function itemQueryArgumentFailure(params: CliData): string | undefined {
  const decoded = decodeArguments(params);
  return "code" in decoded ? failure(ITEM_QUERY_COMMAND, decoded) : undefined;
}

/**
 * The handler answers the envelope for a result and for every typed failure.
 * It rejects with the abort reason when the run is cancelled, and with an
 * `Error` for an implementation defect.
 */
export function createItemQueryHandler(deps: ItemQueryCliDeps): CliHandler {
  return async (params: CliData): Promise<string> => {
    const decoded = decodeArguments(params);
    if ("code" in decoded) return failure(ITEM_QUERY_COMMAND, decoded);

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
    const read = await withLease(deps, ITEM_QUERY_COMMAND, (client, identity) =>
      runItemQueryTo(
        { scope, requireEach: named !== null },
        {
          filter: decoded.filter,
          fields: decoded.fields,
          sort: decoded.sort,
          limit: decoded.limit,
        },
        {
          client,
          signal: deps.signal,
          instrument: deps.instrument,
          begin: (summary, libraries) =>
            outputStep(() =>
              createAnswer(summary, {
                identity,
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
      ),
    );
    if ("answer" in read) return read.answer;
    const exit = read.value;

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

/**
 * Run `read` under one source lease. The lease ends when `read` settles, so
 * it ends after the last database read and before the caller answers or
 * rejects. A source that gives no lease answers `source-unavailable`.
 *
 * The lease carries the source identity of its copy. Preferences can name a
 * newer source while another lease still pins this copy.
 */
async function withLease<T>(
  deps: ItemQueryCliDeps,
  command: ItemQueryCommand,
  read: (client: NodeDatabaseClient, identity: WorkbenchIdentity) => Promise<T>,
): Promise<{ answer: string } | { value: T; identity: WorkbenchIdentity }> {
  let acquired: ItemQueryLease;
  try {
    acquired = await deps.acquireRead();
  } catch (error) {
    logger.warn("Item Query could not read the Zotero source", { error });
    return {
      answer: failure(
        command,
        diagnostic(
          "source-unavailable",
          `The connected Zotero source is not readable: ${messageOf(error)}`,
        ),
      ),
    };
  }
  using lease = acquired;
  const identity = { vault: deps.vault(), source: lease.source };
  return { value: await read(lease.client, identity), identity };
}

type ItemQueryExit = Exit.Exit<
  QueryResult,
  ItemQueryError | ItemQueryLayoutError | ItemQueryDatabaseError
>;

/**
 * Map the `Exit` of one run to the answer. A result and every typed failure
 * become the envelope. Cancellation rejects with the abort reason, and a defect
 * rejects with an `Error`, so neither reads as an answer.
 */
export async function answerExit(
  exit: ItemQueryExit,
  context: {
    /** The identity of the source the run leased. */
    identity: WorkbenchIdentity;
    /** The Target Libraries of the run, in the canonical order. */
    libraries: readonly LibraryWire[];
    signal: AbortSignal;
    onAnswerStep?: (ms: number) => void;
    output?: string;
    openOutput?: ItemQueryCliDeps["openOutput"];
  },
): Promise<string> {
  if (Exit.isSuccess(exit)) return answerResult(exit.value, context);
  return answerFailure(exit.cause, ITEM_QUERY_COMMAND, context.signal);
}

/** Keep cancellation observable between serialization chunks in the worker. */
const ANSWER_STEP_BUDGET_MS = SLICE_BUDGET_MS / 2;
const NO_ROWS = "[]\n}";
const CHUNK_START = '{\n  "rows": [';
const CHUNK_END = "\n  ]\n}";
const FIRST_CHUNK_ROWS = 64;
const CHUNK_TEXT_LENGTH = 256 * 1024;

type AnswerContext = Parameters<typeof answerExit>[1];

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

/** The materialized-result adapter shares the incremental wire encoder. */
async function answerResult(
  result: QueryResult,
  context: AnswerContext,
): Promise<string> {
  try {
    const answer = await createAnswer(result, context);
    await answer.write(result.rows);
    return await answer.end();
  } catch (error) {
    context.signal.throwIfAborted();
    const failed = outputFailure(error);
    if (failed) return failure(ITEM_QUERY_COMMAND, failed.diagnostic);
    throw error;
  }
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
      await file.close();
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

// ---------------------------------------------------------------------------
// Argument decoding

const GROUP_SELECTOR = regex("^group:([1-9]\\d*)$");
const QUERY_ID = /^[\w.-]+$/;
const POSITIVE_INTEGER = /^[1-9]\d*$/;

const librariesSchema = v.pipe(v.array(v.string()), v.minLength(1));
const fieldsSchema = v.array(v.string());
const sortSchema = v.array(
  v.strictObject({
    field: v.string(),
    direction: v.picklist(["asc", "desc"]),
  }),
);

/**
 * Decode the flat arguments, or answer the diagnostic of the first malformed
 * one. Obsidian passes every caller token through, so an undeclared parameter
 * is rejected here too.
 */
function decodeArguments(params: CliData): DecodedArguments | Diagnostic {
  const rejected = rejectParameters(params, ITEM_QUERY_PARAMS);
  if (rejected) return rejected;

  // `libraries` wins over `library`; with neither, the Library Scope decides.
  const named = decodeLibraries(params);
  if (named !== undefined && "code" in named) return named;
  let libraries = named ?? null;
  if (named === undefined && params.library !== undefined) {
    const selector = parseSelector(params.library);
    if (selector === null) {
      return invalid(
        "library",
        `'${params.library}' is not a Library: use personal or group:<groupID>.`,
      );
    }
    libraries = {
      scope: { mode: "selected", libraries: [selector] },
      parameter: "library",
    };
  }

  const filter = params.filter;
  if (filter !== undefined && filter.trim() === "") {
    return invalid(
      "filter",
      "filter is empty: give a Filter Expression, or omit filter to match every Item.",
    );
  }

  const fields = decodeJson(params, "fields");
  if (fields !== undefined && "code" in fields) return fields;

  const sort = decodeJson(params, "sort");
  if (sort !== undefined && "code" in sort) return sort;

  let limit: number | null = DEFAULT_CLI_LIMIT;
  if (params.limit !== undefined) {
    if (params.limit === "all") limit = null;
    else if (
      POSITIVE_INTEGER.test(params.limit) &&
      Number.isSafeInteger(Number(params.limit))
    ) {
      limit = Number(params.limit);
    } else {
      return invalid(
        "limit",
        `limit '${params.limit}' is not a positive integer: use a positive integer, or all for every match.`,
      );
    }
  }

  const output = params.output;
  if (output !== undefined && (!isAbsolute(output) || output.includes("\0"))) {
    return invalid(
      "output",
      "output must be an absolute path to a new JSON file.",
    );
  }

  if (params.id !== undefined) {
    const malformed = rejectQueryId(params.id);
    if (malformed) return malformed;
  }
  return { libraries, filter, fields, sort, limit, output };
}

function rejectQueryId(id: string): Diagnostic | null {
  if (id.length <= QUERY_ID_MAX_LENGTH && QUERY_ID.test(id)) return null;
  return invalid("id", `id '${id}' is not a query id: use ${QUERY_ID_FORM}.`);
}

/** The Library that `personal` or `group:<groupID>` names. */
function parseSelector(text: string): LibrarySelector | null {
  if (text === "personal") return { type: "personal" };
  const group = GROUP_SELECTOR.exec(text);
  return group ? { type: "group", groupID: Number(group[1]) } : null;
}

/** Decode `libraries`: the word `all`, or a JSON array of selector texts. */
function decodeLibraries(
  params: CliData,
): NamedLibraries | Diagnostic | undefined {
  if (params.libraries === "all") {
    return { scope: { mode: "all" }, parameter: "libraries" };
  }
  const texts = decodeJson(params, "libraries");
  if (texts === undefined || "code" in texts) return texts;
  const selectors: LibrarySelector[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    const selector = parseSelector(text);
    if (selector === null) {
      return invalid(
        "libraries",
        `'${text}' in libraries is not a Library: use "personal" or "group:<groupID>".`,
      );
    }
    if (seen.has(text)) {
      return invalid(
        "libraries",
        `libraries names '${text}' twice: name each Library once.`,
      );
    }
    seen.add(text);
    selectors.push(selector);
  }
  return {
    scope: {
      mode: "selected",
      libraries: selectors.toSorted(compareSelectors),
    },
    parameter: "libraries",
  };
}

/** The JSON-encoded arguments, with the form each one takes. */
const JSON_ARGUMENTS = {
  libraries: {
    schema: librariesSchema,
    expected:
      'all, or a JSON array of at least one Library, each "personal" or "group:<groupID>"',
  },
  fields: {
    schema: fieldsSchema,
    expected: "a JSON array of Projection Path strings",
  },
  sort: {
    schema: sortSchema,
    expected:
      'a JSON array of {"field","direction"} objects with direction "asc" or "desc"',
  },
} as const;

type JsonArgument = keyof typeof JSON_ARGUMENTS;

function decodeJson<K extends JsonArgument>(
  params: CliData,
  parameter: K,
):
  | v.InferOutput<(typeof JSON_ARGUMENTS)[K]["schema"]>
  | Diagnostic
  | undefined {
  const { schema, expected } = JSON_ARGUMENTS[parameter];
  const raw = params[parameter];
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalid(
      parameter,
      `${parameter} is not valid JSON: use ${expected}.`,
    );
  }
  const result = v.safeParse(schema, parsed);
  if (!result.success) {
    return invalid(parameter, `${parameter} is not ${expected}.`);
  }
  return result.output as v.InferOutput<(typeof JSON_ARGUMENTS)[K]["schema"]>;
}

/**
 * The diagnostic of the first parameter outside `accepted`. Obsidian passes
 * every caller token through; its own `--` tokens pass.
 */
function rejectParameters(
  params: CliData,
  accepted: readonly string[],
): Diagnostic | null {
  for (const key of Object.keys(params)) {
    if (key.startsWith("--") || accepted.includes(key)) continue;
    if (key === "vault") {
      return invalid(
        "vault",
        "vault must come before the command name (obsidian vault=<name> zotlit:...); placed after, Obsidian ignores it and routes the call by working directory or focused window instead.",
      );
    }
    return invalid(
      key,
      accepted.length === 0
        ? `Unknown parameter '${key}': this command takes no parameters.`
        : `Unknown parameter '${key}': use ${accepted.join(", ")}.`,
    );
  }
  return null;
}

function invalid(parameter: string, message: string): Diagnostic {
  return diagnostic("invalid-argument", message, { details: { parameter } });
}
