// Registers the Item Query commands with Obsidian's CLI: the only Promise edge
// of `@zotlit/item-query` (ADR 0066). The query command decodes the flat
// arguments, takes the source lease, resolves the Target Library, runs the
// query, and answers the versioned envelope of ADR 0065. The schema command
// answers the Item Query Schema of the source in the same envelope; the guide
// command prints plain text.
//
// Command, flag, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import { Cause, Exit } from "effect";
import type { CliData, CliFlag, CliFlags, CliHandler, Plugin } from "obsidian";
import * as v from "valibot";

import { getLibraries, getLibraryByGroupID } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import type {
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";
import type {
  ItemQueryError,
  ItemQuerySchema,
  ProjectionValue,
  QueryResult,
  SortSpec,
  TargetLibrary,
} from "@zotlit/item-query";

import { getLogger } from "@/lib/log";
import type { WorkbenchIdentity } from "@/services/template-workbench/envelope";

import { GUIDE_TOPIC_NAMES, parseGuideTopic, renderGuide } from "./guide";
import { runDescribeItemQuery, runItemQuery } from "./run";

const logger = getLogger(["item-query"]);

/**
 * The wire format of the Item Query commands, versioned on its own (ADR 0065):
 * it evolves independently from the Template Contract.
 */
export const CONTRACT_VERSION = 1;

export const ITEM_QUERY_COMMAND = "zotlit:item-query" as const;
export const ITEM_QUERY_SCHEMA_COMMAND = "zotlit:item-query-schema" as const;
export const ITEM_QUERY_GUIDE_COMMAND = "zotlit:item-query-guide" as const;

type ItemQueryCommand =
  | typeof ITEM_QUERY_COMMAND
  | typeof ITEM_QUERY_SCHEMA_COMMAND
  | typeof ITEM_QUERY_GUIDE_COMMAND;

/** The rows a CLI query returns when the caller gives no limit. */
export const DEFAULT_CLI_LIMIT = 100;

const ITEM_QUERY_PARAMS = [
  "filter",
  "fields",
  "sort",
  "limit",
  "library",
] as const;

type ItemQueryParam = (typeof ITEM_QUERY_PARAMS)[number];

export const itemQueryFlags: CliFlags = {
  filter: {
    value: "<expression>",
    description:
      "Filter Expression that selects the Items; omit it to match every Item",
  },
  fields: {
    value: "<json>",
    description:
      'JSON array of Projection Paths, such as ["title","date.year"]; [] returns only Indexed Keys',
  },
  sort: {
    value: "<json>",
    description:
      'JSON array of {"field","direction"} objects; direction is "asc" or "desc"',
  },
  limit: {
    value: "<n|all>",
    description:
      "Most rows to return: a positive integer, or all (default 100)",
  },
  library: {
    value: "<personal|group:id>",
    description:
      "Target Library: personal, or group:<groupID> (default: personal)",
  },
} satisfies Record<ItemQueryParam, CliFlag>;

export const itemQueryGuideFlags: CliFlags = {
  topic: {
    value: `<${GUIDE_TOPIC_NAMES.join("|")}>`,
    description: "Guide topic; omit it for the quickstart",
  },
} satisfies Record<"topic", CliFlag>;

/**
 * The diagnostic codes this adapter raises itself, each defined with the
 * recovery action its diagnostic carries. An invalid query keeps the code and
 * hint of its `ItemQueryError`.
 */
const DIAGNOSTIC_HINTS = {
  "invalid-argument":
    "Correct the parameter named in details.parameter, then run the command again.",
  "source-unavailable":
    "Run the command again once the connected Zotero source is readable; when the message reports a failure, ask the user to check the plugin log.",
  "library-not-found":
    "Use library=personal, or the group ID of a group Library that the connected Zotero source holds.",
  "database-error":
    "Run the command again; if it fails again, ask the user to check the plugin log.",
  "unsupported-database-layout":
    "Ask the user to update ZotLit: this ZotLit version cannot read the way their Zotero version stores its data. Running the command again gives the same result until then.",
} as const satisfies Record<string, string>;

type AdapterDiagnosticCode = keyof typeof DIAGNOSTIC_HINTS;

interface Diagnostic {
  code: AdapterDiagnosticCode | ItemQueryError["code"];
  message: string;
  hint: string;
  /** Where an invalid query went wrong. */
  location?: ItemQueryError["location"];
  details?: { parameter: string };
}

function diagnostic(
  code: AdapterDiagnosticCode,
  message: string,
  details?: Diagnostic["details"],
): Diagnostic {
  return { code, message, hint: DIAGNOSTIC_HINTS[code], details };
}

/** The Target Library on the wire: local `libraryID` values stay inside. */
type LibraryWire =
  | { type: "personal" }
  | { type: "group"; groupID: number; name: string };

type LibrarySelector =
  | { type: "personal" }
  | { type: "group"; groupID: number };

/** The flat arguments after decoding. */
interface DecodedArguments {
  library: LibrarySelector;
  filter: string | undefined;
  fields: readonly string[] | undefined;
  sort: readonly SortSpec[] | undefined;
  limit: number | null;
}

type EnvelopeTail =
  | { ok: false; diagnostic: Diagnostic }
  | {
      ok: true;
      identity: WorkbenchIdentity;
      library: LibraryWire;
      request: object;
      returnedCount: number;
      truncated: boolean;
      rows: readonly { indexedKey: string; values: object }[];
    }
  | { ok: true; identity: WorkbenchIdentity; schema: SchemaWire };

/** The Item Query Schema with the defaults of the CLI in place of the package's. */
type SchemaWire = Omit<ItemQuerySchema, "defaults"> & {
  defaults: Omit<ItemQuerySchema["defaults"], "limit"> & {
    limit: number;
    library: "personal";
  };
};

function envelope(command: ItemQueryCommand, tail: EnvelopeTail): string {
  return JSON.stringify(
    { contractVersion: CONTRACT_VERSION, command, ...tail },
    null,
    2,
  );
}

function failure(
  diagnostic: Diagnostic,
  command: ItemQueryCommand = ITEM_QUERY_COMMAND,
): string {
  return envelope(command, { ok: false, diagnostic });
}

/** A pinned read of the active Zotero source, released on dispose. */
export interface ItemQueryLease extends Disposable {
  readonly client: NodeDatabaseClient;
}

export interface ItemQueryCliDeps {
  acquireRead(): Promise<ItemQueryLease>;
  identity(): Promise<WorkbenchIdentity>;
  /** Cancels every run, such as when the plugin unloads. */
  signal: AbortSignal;
}

export function registerItemQueryCli(
  plugin: Plugin,
  deps: Omit<ItemQueryCliDeps, "signal">,
): void {
  const unload = new AbortController();
  plugin.register(() => unload.abort());
  plugin.registerCliHandler(
    ITEM_QUERY_COMMAND,
    "Query the Items of one Zotero Library and return the matches as JSON",
    itemQueryFlags,
    createItemQueryHandler({ ...deps, signal: unload.signal }),
  );
  plugin.registerCliHandler(
    ITEM_QUERY_SCHEMA_COMMAND,
    "Describe the fields, functions, and defaults of Item Query as JSON",
    null,
    createItemQuerySchemaHandler({ ...deps, signal: unload.signal }),
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
    if (rejected) return failure(rejected, ITEM_QUERY_SCHEMA_COMMAND);

    deps.signal.throwIfAborted();

    let lease: ItemQueryLease;
    try {
      lease = await deps.acquireRead();
    } catch (error) {
      logger.warn("Item Query could not read the Zotero source", { error });
      return failure(
        diagnostic(
          "source-unavailable",
          `The connected Zotero source is not readable: ${messageOf(error)}`,
        ),
        ITEM_QUERY_SCHEMA_COMMAND,
      );
    }
    let exit: Exit.Exit<
      ItemQuerySchema,
      ItemQueryLayoutError | ItemQueryDatabaseError
    >;
    try {
      exit = await runDescribeItemQuery({
        client: lease.client,
        signal: deps.signal,
      });
    } finally {
      lease[Symbol.dispose]();
    }

    if (Exit.isSuccess(exit)) {
      const schema = exit.value;
      return envelope(ITEM_QUERY_SCHEMA_COMMAND, {
        ok: true,
        identity: await deps.identity(),
        schema: {
          ...schema,
          defaults: {
            ...schema.defaults,
            limit: DEFAULT_CLI_LIMIT,
            library: "personal",
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
  if (rejected) return failure(rejected, ITEM_QUERY_GUIDE_COMMAND);
  if (params.topic === undefined) return renderGuide(null);
  const topic = parseGuideTopic(params.topic);
  if (topic === null) {
    return failure(
      invalid(
        "topic",
        `topic '${params.topic}' is not a guide topic: use ${GUIDE_TOPIC_NAMES.join(", ")}.`,
      ),
      ITEM_QUERY_GUIDE_COMMAND,
    );
  }
  return renderGuide(topic);
}

/**
 * The handler answers the envelope for a result and for every typed failure.
 * It rejects with the abort reason when the run is cancelled, and with an
 * `Error` for an implementation defect.
 */
export function createItemQueryHandler(deps: ItemQueryCliDeps): CliHandler {
  return async (params: CliData): Promise<string> => {
    const decoded = decodeArguments(params);
    if ("code" in decoded) return failure(decoded);

    deps.signal.throwIfAborted();

    let lease: ItemQueryLease;
    try {
      lease = await deps.acquireRead();
    } catch (error) {
      logger.warn("Item Query could not read the Zotero source", { error });
      return failure(
        diagnostic(
          "source-unavailable",
          `The connected Zotero source is not readable: ${messageOf(error)}`,
        ),
      );
    }

    let library: ResolvedLibrary | null;
    let exit: ItemQueryExit;
    try {
      try {
        library = resolveLibrary(lease.client, decoded.library);
      } catch (error) {
        return databaseFailure(error);
      }
      if (library === null) {
        return failure(
          diagnostic(
            "library-not-found",
            `The connected Zotero source holds no ${describeSelector(decoded.library)}.`,
            { parameter: "library" },
          ),
        );
      }
      exit = await runItemQuery(
        {
          library: library.target,
          filter: decoded.filter,
          fields: decoded.fields,
          sort: decoded.sort,
          limit: decoded.limit,
        },
        { client: lease.client, signal: deps.signal },
      );
    } finally {
      lease[Symbol.dispose]();
    }

    return answerExit(exit, {
      identity: () => deps.identity(),
      library: library.wire,
      signal: deps.signal,
    });
  };
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
    identity: () => Promise<WorkbenchIdentity>;
    library: LibraryWire;
    signal: AbortSignal;
  },
): Promise<string> {
  if (Exit.isSuccess(exit)) {
    const result = exit.value;
    return envelope(ITEM_QUERY_COMMAND, {
      ok: true,
      identity: await context.identity(),
      library: context.library,
      request: result.query,
      returnedCount: result.returnedCount,
      truncated: result.truncated,
      rows: result.rows.map((row) => ({
        indexedKey: row.indexedKey,
        values: toWire(row.values) as object,
      })),
    });
  }

  return answerFailure(exit.cause, ITEM_QUERY_COMMAND, context.signal);
}

/**
 * Map the failure of one run to the answer of `command`: every typed failure
 * becomes the envelope, cancellation rejects with the abort reason, and a
 * defect rejects with an `Error`.
 */
function answerFailure(
  cause: Cause.Cause<
    ItemQueryError | ItemQueryLayoutError | ItemQueryDatabaseError
  >,
  command: ItemQueryCommand,
  signal: AbortSignal,
): string {
  const error = Cause.findErrorOption(cause);
  if (error._tag === "Some") {
    const failed = error.value;
    if (failed._tag === "ItemQueryError") {
      return failure(
        {
          code: failed.code,
          message: failed.message,
          hint: failed.hint,
          location: failed.location,
        },
        command,
      );
    }
    if (failed._tag === "ItemQueryLayoutError") {
      // `@zotlit/db` logs the missing layout and the versions once per copy.
      return failure(
        diagnostic("unsupported-database-layout", failed.message),
        command,
      );
    }
    return databaseFailure(failed.cause, failed, command);
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
  cause: unknown,
  logged: unknown = cause,
  command: ItemQueryCommand = ITEM_QUERY_COMMAND,
): string {
  logger.error("Item Query failed to read the Zotero database", {
    error: logged,
  });
  return failure(
    diagnostic(
      "database-error",
      `Item Query could not read the Zotero database: ${messageOf(cause)}`,
    ),
    command,
  );
}

function describeSelector(selector: LibrarySelector): string {
  return selector.type === "group"
    ? `group Library with the group ID ${selector.groupID}`
    : "personal Library";
}

interface ResolvedLibrary {
  target: TargetLibrary;
  wire: LibraryWire;
}

function resolveLibrary(
  client: NodeDatabaseClient,
  selector: LibrarySelector,
): ResolvedLibrary | null {
  if (selector.type === "personal") {
    const personal = getLibraries(client).find(
      (library) => library.type === "user",
    );
    if (!personal) return null;
    return {
      target: { libraryID: personal.libraryID, groupID: null },
      wire: { type: "personal" },
    };
  }
  const group = getLibraryByGroupID(client, selector.groupID);
  if (!group) return null;
  return {
    target: { libraryID: group.libraryID, groupID: selector.groupID },
    wire: {
      type: "group",
      groupID: selector.groupID,
      name: group.name ?? "",
    },
  };
}

/** Temporal values become ISO strings; every other value is JSON already. */
function toWire(
  value: ProjectionValue | Readonly<Record<string, ProjectionValue>>,
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (
    value instanceof Temporal.Instant ||
    value instanceof Temporal.PlainDate ||
    value instanceof Temporal.PlainYearMonth
  ) {
    return value.toString();
  }
  if (Array.isArray(value))
    return value.map((entry: ProjectionValue) => toWire(entry));
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, toWire(entry)]),
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Argument decoding

const GROUP_SELECTOR = /^group:([1-9]\d*)$/;
const POSITIVE_INTEGER = /^[1-9]\d*$/;

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

  let library: LibrarySelector = { type: "personal" };
  if (params.library !== undefined) {
    const group = GROUP_SELECTOR.exec(params.library);
    if (params.library === "personal") library = { type: "personal" };
    else if (group) library = { type: "group", groupID: Number(group[1]) };
    else {
      return invalid(
        "library",
        `'${params.library}' is not a Library: use personal or group:<groupID>.`,
      );
    }
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

  return { library, filter, fields, sort, limit };
}

/** The JSON-encoded arguments, with the form each one takes. */
const JSON_ARGUMENTS = {
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
  return diagnostic("invalid-argument", message, { parameter });
}
