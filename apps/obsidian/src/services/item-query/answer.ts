// The answer of one Query Job inside the ZoteroReads worker: the versioned
// envelope of ADR 0065 for the schema or the query of a CLI dataset. A query
// answer resolves the Target Libraries on the database of the job, runs the
// engine, and encodes the envelope in chunks, inline or to the export writer;
// a CSV or TSV export writes delimited rows to the file in its place.
// Every typed failure is the envelope of the command of the job. The Query Job
// (`job.ts`) provides the database, the scheduler and the scope.
//
// Command, flag, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import { readLibraries } from "@zotlit/db/item-query";
import type {
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";
import {
  listQueryValues,
  renderDiagnostic,
  AttachmentFileResolver,
  consumeQuery,
  describeQueryCustomFields,
  SLICE_BUDGET_MS,
  ITEMS,
  valueText,
} from "@zotlit/item-query";
import type {
  ItemQueryRequest,
  ItemQueryError,
  ProjectionJson,
  QueryRow,
  QuerySummary,
  ResolveAttachmentFile,
} from "@zotlit/item-query";
import { delimitedLines, delimitedStart } from "@zotlit/shared/delimited";
import type { DelimitedFormat } from "@zotlit/shared/delimited";

import { resourceReleaseUrl } from "@/lib/constants";
import { Cause, Data, Effect } from "@/lib/effect";
import type { Scope } from "@/lib/effect";
import { getLogger } from "@/lib/log";
import {
  resolveLibraryScope,
  selectorKey,
} from "@/services/library-scope/scope";
import type {
  LibraryScope,
  LibrarySelector,
} from "@/services/library-scope/scope";
import type { WorkbenchIdentity } from "@/services/template-workbench/envelope";

import {
  DEFAULT_CLI_LIMIT,
  diagnostic,
  envelope,
  failure,
  INLINE_MAX_BYTES,
} from "./contract";
import type { Diagnostic, QueryCliCommand, LibraryWire } from "./contract";
import { CLI_DATASETS } from "./datasets";
import type { DecodedQuery, NamedLibraries } from "./decode";
import type {
  QueryViewGroup,
  QueryViewResult,
  QueryViewRow,
} from "./query-view";
import type {
  QueryCommand,
  QueryReply,
  QueryViewCommand,
  QueryViewReply,
} from "./worker-protocol";

const logger = getLogger(["item-query"]);

/** What the answer reads of a Query Job. */
export type AnswerJob = QueryCommand & {
  /**
   * The Library Scope in force: the default Target Libraries of a query are
   * its available Libraries.
   */
  scope: LibraryScope;
};

/** The environment of one answer inside its Query Job. */
export interface AnswerEnv {
  /** The identity of the source the job leased. */
  identity: WorkbenchIdentity;
  /** Resolves the file of an Attachment that an Annotation Query projects. */
  attachmentFiles?: ResolveAttachmentFile;
  /** Observes the engine of each query run; the measurement command sets it. */
  instrument?: QueryInstrument;
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
  ) => Effect.Effect<QueryWriter, QueryOutputError, Scope.Scope>;
}

/**
 * Wraps the operation of one run before it starts, to provide the observer
 * references of the engine. Only the dev-build measurement command passes one.
 */
export type QueryInstrument = <A, E, R>(
  operation: Effect.Effect<A, E, R>,
) => Effect.Effect<A, E, R>;

/** The output file of an export: each write finishes before the next. */
export interface QueryWriter {
  write(text: string): Effect.Effect<void, QueryOutputError>;
}

/** The output of the answer failed: the envelope carries `diagnostic`. */
export class QueryOutputError extends Data.TaggedError("QueryOutputError")<{
  diagnostic: Diagnostic;
}> {}

/**
 * The source holds no Target Library for the run, so the run reads no record.
 */
export class TargetLibrariesUnavailable extends Data.TaggedError(
  "TargetLibrariesUnavailable",
)<{
  /**
   * - `named-missing`: the caller named a Library that the source does not
   *   hold.
   * - `named-none`: the caller named the Libraries, such as all of them, and
   *   the source holds none.
   * - `scope-none`: the source holds no Library of the Library Scope in force.
   */
  readonly reason: "named-missing" | "named-none" | "scope-none";
  /**
   * For `named-missing`: the first named Library that the source does not
   * hold, in the canonical order.
   */
  readonly missing?: LibrarySelector;
}> {}

/**
 * The answer of a job is the envelope for a result and for every typed
 * failure, under the command of the job. Cancellation interrupts it, and an
 * implementation defect dies with an `Error`.
 */
export function answer(
  job: AnswerJob,
  env: AnswerEnv,
): Effect.Effect<QueryReply, never, ItemQueryDatabase | Scope.Scope> {
  if ("values" in job) return answerValues(job, env);
  return job.schema
    ? answerSchema(job, env, job.pluginVersion)
    : answerQuery(job, env, job.query);
}

function answerSchema(
  job: AnswerJob,
  env: AnswerEnv,
  pluginVersion: string,
): Effect.Effect<QueryReply, never, ItemQueryDatabase> {
  const { command } = job;
  const selected = Object.entries(CLI_DATASETS).filter(
    ([id]) => job.dataset === undefined || id === job.dataset,
  );
  return describeQueryCustomFields(ITEMS).pipe(
    Effect.map((customFields) =>
      inline(
        command,
        envelope(command, {
          ok: true,
          identity: env.identity,
          schema: {
            url: `${resourceReleaseUrl(pluginVersion)}/query.schema.json`,
            fileName: `zotlit-query-${pluginVersion}.schema.json`,
          },
          customFields,
          datasets: Object.fromEntries(
            selected.map(([id, { engine }]) => [
              id,
              {
                fields: engine.names,
                customPrefix: engine.customPrefix,
              },
            ]),
          ),
          defaults: Object.fromEntries(
            selected.map(([id, { engine }]) => [
              id,
              {
                fields: engine.defaultFields,
                sort: engine.defaultSort,
                limit: DEFAULT_CLI_LIMIT,
                library: { source: "library-scope" as const },
              },
            ]),
          ),
        }),
      ),
    ),
    answerFailure(command),
  );
}

function answerQuery(
  job: AnswerJob,
  env: AnswerEnv,
  decoded: DecodedQuery,
): Effect.Effect<QueryReply, never, ItemQueryDatabase | Scope.Scope> {
  const { command } = job;
  const named = decoded.libraries;
  const operation = Effect.gen(function* () {
    const available = yield* targetLibraries(named, job.scope);
    const request: ItemQueryRequest = {
      filter: decoded.filter,
      group: decoded.group,
      fields: decoded.fields,
      formulas: decoded.formulas,
      sort: decoded.sort,
      limit: decoded.limit,
      context: decoded.context,
      libraries: available.map(({ libraryID, selector }) => ({
        libraryID,
        groupID: selector.type === "group" ? selector.groupID : null,
      })),
    };
    // The Query Clock is the system clock and zone.
    return yield* consumeQuery(
      CLI_DATASETS[decoded.from].engine,
      request,
      (summary) =>
        createAnswer(summary, {
          command,
          from: decoded.from,
          identity: env.identity,
          libraries: available.map(({ selector, name }) =>
            selector.type === "group"
              ? { ...selector, name: name ?? "" }
              : selector,
          ),
          onAnswerStep: env.onAnswerStep,
          output: decoded.output,
          format: decoded.format,
          openOutput: env.openOutput,
        }),
    ).pipe(
      Effect.provideService(
        AttachmentFileResolver,
        env.attachmentFiles ?? null,
      ),
    );
  });
  return (env.instrument?.(operation) ?? operation).pipe(
    answerFailure(command, named?.parameter),
  );
}

/** What the answer of a typed query reads of its job. */
export type AnswerViewJob = QueryViewCommand & {
  /** The Library Scope in force: the default Target Libraries. */
  scope: LibraryScope;
};

/**
 * The answer of the typed query of a Query View: every row up to the limit
 * of the request, as JSON data. A typed failure is the diagnostic that the
 * envelope of the same query carries. Cancellation interrupts it, and an
 * implementation defect dies with an `Error`.
 */
export function answerView(
  job: AnswerViewJob,
  env: Pick<AnswerEnv, "attachmentFiles">,
): Effect.Effect<QueryViewReply, never, ItemQueryDatabase> {
  const { command, view } = job;
  const named =
    view.libraries === undefined
      ? null
      : { scope: view.libraries, parameter: "library" as const };
  return Effect.gen(function* () {
    const available = yield* targetLibraries(named, job.scope);
    const request: ItemQueryRequest = {
      filter: view.filter,
      group: view.group,
      fields: view.fields,
      formulas: view.formulas,
      // A Formula with a mistake leaves out only itself and its readers.
      onFormulaFault: "leave-out",
      sort: view.sort,
      limit: view.limit ?? null,
      context: view.context,
      libraries: available.map(({ libraryID, selector }) => ({
        libraryID,
        groupID: selector.type === "group" ? selector.groupID : null,
      })),
    };
    const libraries = available.map(({ selector, name }) =>
      selector.type === "group" ? { ...selector, name: name ?? "" } : selector,
    );
    const result = yield* consumeQuery(
      CLI_DATASETS[view.from].engine,
      request,
      (summary) => Effect.sync(() => collectView(summary, libraries)),
    ).pipe(
      Effect.provideService(
        AttachmentFileResolver,
        env.attachmentFiles ?? null,
      ),
    );
    return viewReply(command, { kind: "result", result });
  }).pipe(
    Effect.catch((failed) =>
      Effect.succeed(
        viewReply(command, {
          kind: "failed",
          diagnostic: failureDiagnostic(failed, named?.parameter),
          ...(failed._tag === "ItemQueryError" &&
            failed.formulaDiagnostics && {
              formulaDiagnostics: failed.formulaDiagnostics,
            }),
        }),
      ),
    ),
    Effect.catchDefect(dieOfDefect),
  );
}

const viewReply = (
  command: QueryCliCommand,
  view: QueryViewReply["view"],
): QueryViewReply => ({
  command,
  answer: "",
  receipt: { kind: "inline" },
  view,
});

/**
 * Collect the rows of a typed query in their groups. Each chunk becomes JSON
 * as it arrives, as the envelope writes it, so the result crosses the worker
 * seam.
 */
function collectView(summary: QuerySummary, libraries: readonly LibraryWire[]) {
  const { groups: summaries, totalCount, ...metadata } = summary;
  // `metadata` carries `matchedCount`: the count of every match before the
  // limit, grouped or not.
  const rows: QueryViewRow[] = [];
  const groups = summaries?.map(
    (group): QueryViewGroup & { rows: QueryViewRow[] } => ({
      ...group,
      rows: [],
    }),
  );
  return {
    write: (chunk: readonly QueryRow[], groupIndex?: number) =>
      Effect.sync(() => {
        const target =
          groups && groupIndex !== undefined ? groups[groupIndex]!.rows : rows;
        const wire = JSON.parse(JSON.stringify(chunk)) as QueryViewRow[];
        for (const row of wire) target.push(row);
      }),
    end: () =>
      Effect.succeed<QueryViewResult>(
        groups
          ? { ...metadata, libraries, totalCount: totalCount!, groups }
          : { ...metadata, libraries, rows },
      ),
  };
}

/** Resolve the same Target Libraries for queries and value discovery. */
const targetLibraries = Effect.fnUntraced(function* (
  named: NamedLibraries | null,
  scope: LibraryScope,
) {
  const requireEach = named !== null;
  // The resolution of the Library Scope service, on the rows of the one
  // Library reader of `getLibraries`, read on the borrowed client.
  const libraries = resolveLibraryScope(
    yield* readLibraries(),
    named ? named.scope : scope,
  );
  const { available, unavailable } = libraries;
  const [missing] = unavailable;
  if (requireEach && missing) {
    return yield* new TargetLibrariesUnavailable({
      reason: "named-missing",
      missing,
    });
  }
  if (available.length === 0) {
    return yield* new TargetLibrariesUnavailable({
      reason: requireEach ? "named-none" : "scope-none",
    });
  }
  return available;
});

const answerValues = (
  job: Extract<AnswerJob, { values: unknown }>,
  env: AnswerEnv,
) =>
  Effect.gen(function* () {
    const decoded = job.values;
    const available = yield* targetLibraries(decoded.libraries, job.scope);
    const values = [];
    for (const library of available) {
      const listing = yield* listQueryValues(library, decoded);
      values.push({
        library: selectorKey(library.selector),
        name: library.name ?? "My Library",
        ...listing,
      });
    }
    const text = envelope(job.command, {
      ok: true,
      identity: env.identity,
      libraries: available.map(({ selector, name }) =>
        selector.type === "group"
          ? { ...selector, name: name ?? "" }
          : selector,
      ),
      request: {
        kind: decoded.kind,
        library: available.map(({ selector }) => selectorKey(selector)),
        ...(decoded.match === undefined ? {} : { match: decoded.match }),
        limit: decoded.limit,
      },
      returnedCount: values.reduce(
        (count, library) => count + library.returnedCount,
        0,
      ),
      truncated: values.some((library) => library.truncated),
      values,
    });
    if (Buffer.byteLength(text) > INLINE_MAX_BYTES) {
      return yield* new QueryOutputError({
        diagnostic: renderDiagnostic({
          ...diagnostic(
            "result-too-large",
            `The JSON response exceeds the inline limit of ${INLINE_MAX_BYTES} bytes.`,
          ),
          hint: "Narrow match or reduce limit in zotlit:query-values, then run it again.",
        }),
      });
    }
    return inline(job.command, text);
  }).pipe(answerFailure(job.command, job.values.libraries?.parameter));

const inline = (command: QueryCliCommand, text: string): QueryReply => ({
  command,
  answer: text,
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
  from: DecodedQuery["from"];
  command: QueryCliCommand;
  /** The identity of the source the run leased. */
  identity: WorkbenchIdentity;
  /** The Target Libraries of the run, in the canonical order. */
  libraries: readonly LibraryWire[];
  onAnswerStep?: (ms: number) => void;
  output?: string;
  /** The format of the output file; omitted, the JSON response. */
  format?: DelimitedFormat;
  openOutput?: AnswerEnv["openOutput"];
}

/** How the answer writes its rows: the JSON envelope, or delimited lines. */
interface RowsEncoder {
  /** The text before the first row. */
  readonly start: string;
  /** The text that closes the group `previous`, if any, and opens `groupIndex`. */
  group(groupIndex: number, previous: number | undefined): string;
  /** The text of one chunk of the rows of the group open now, if any. */
  rows(chunk: readonly QueryRow[], groupIndex: number | undefined): string;
  /** The text after the last row, with `lastGroup` open, if any. */
  end(lastGroup: number | undefined): string;
}

/** Byte-identical pretty JSON of the envelope that `head` begins. */
function jsonRows(result: QuerySummary, head: string): RowsEncoder {
  const grouped = result.groups !== undefined;
  let first = true;
  return {
    start:
      result.returnedCount === 0 ? head : `${head.slice(0, -NO_ROWS.length)}[`,
    group(groupIndex, previous) {
      const group = result.groups![groupIndex]!;
      const header = JSON.stringify({ ...group, rows: [] }, null, 2);
      first = true;
      return `${previous === undefined ? "" : "\n      ]\n    },"}\n    ${header.slice(0, -NO_ROWS.length).replaceAll("\n", "\n    ")}[`;
    },
    rows(chunk) {
      const wire = JSON.stringify({ rows: chunk }, null, 2).slice(
        CHUNK_START.length,
        -CHUNK_END.length,
      );
      const indented = grouped ? wire.replaceAll("\n", "\n    ") : wire;
      const part = first ? indented : `,${indented}`;
      first = false;
      return part;
    },
    end: (lastGroup) =>
      `${lastGroup === undefined ? "" : "\n      ]\n    }"}${result.returnedCount > 0 ? CHUNK_END : ""}`,
  };
}

/**
 * One delimited line for each row: its group value when the query groups,
 * its Indexed Key, and the text of each field, under a header line of their
 * names. A row in two groups is a line in each. Each value reads as the Query
 * View writes it, from the JSON the envelope would hold.
 */
function delimitedRows(
  result: QuerySummary,
  format: DelimitedFormat,
): RowsEncoder {
  const grouped = result.groups !== undefined;
  const { fields } = result.query;
  const header = [...(grouped ? ["group"] : []), "indexedKey", ...fields];
  return {
    start: delimitedStart(format) + delimitedLines([header], format),
    group: () => "",
    rows(chunk, groupIndex) {
      const group = grouped
        ? [valueText(result.groups![groupIndex!]!.value)]
        : [];
      // A date is its ISO text in JSON, as the envelope writes it.
      const wire = JSON.parse(JSON.stringify(chunk)) as readonly {
        indexedKey: string;
        values: Readonly<Record<string, ProjectionJson>>;
      }[];
      return delimitedLines(
        wire.map((row) => [
          ...group,
          row.indexedKey,
          ...fields.map((field) => valueText(row.values[field])),
        ]),
        format,
      );
    },
    end: () => "",
  };
}

/**
 * The answer in chunks: only the current projection chunk is retained. Each
 * chunk is one step of the job fiber, so the scheduler of the job can end a
 * slice and an interrupt can land between two chunks.
 */
const createAnswer = Effect.fnUntraced(function* (
  result: QuerySummary,
  context: AnswerContext,
) {
  const summary = {
    ok: true as const,
    identity: context.identity,
    libraries: context.libraries,
    request: {
      from: context.from,
      library: context.libraries.map(selectorKey),
      ...result.query,
    },
    returnedCount: result.returnedCount,
    truncated: result.truncated,
    ...(result.totalCount === undefined
      ? {}
      : { totalCount: result.totalCount }),
    warnings: result.warnings,
  };
  const grouped = result.groups !== undefined;
  const { output, openOutput, format } = context;
  // Only a file holds CSV or TSV: the decoder asks for output with them.
  if (format !== undefined && output === undefined)
    return yield* Effect.die(
      new Error(`ZotLit Query ${format} export has no output path`),
    );
  const encoder =
    format === undefined
      ? jsonRows(
          result,
          envelope(context.command, {
            ...summary,
            ...(grouped ? { groups: [] } : { rows: [] }),
          }),
        )
      : delimitedRows(result, format);
  let activeGroup: number | undefined;
  let text = "";
  let bytes = 0;
  let chunkRows = FIRST_CHUNK_ROWS;
  // Open only after query validation and Library resolution succeed.
  let file: QueryWriter | undefined;
  if (output !== undefined) {
    if (!openOutput)
      return yield* Effect.die(
        new Error("ZotLit Query export has no file writer"),
      );
    file = yield* openOutput(output);
  }
  const append = (chunk: string) =>
    Effect.suspend(() => {
      bytes += Buffer.byteLength(chunk);
      if (file) return file.write(chunk);
      if (bytes > INLINE_MAX_BYTES)
        return Effect.fail(
          new QueryOutputError({
            diagnostic: diagnostic(
              "result-too-large",
              `The JSON response exceeds the inline limit of ${INLINE_MAX_BYTES} bytes.`,
            ),
          }),
        );
      text += chunk;
      return Effect.void;
    });
  yield* append(encoder.start);
  return {
    write: Effect.fnUntraced(function* (
      rows: readonly QueryRow[],
      groupIndex?: number,
    ) {
      if (grouped && groupIndex !== activeGroup) {
        yield* append(encoder.group(groupIndex!, activeGroup));
        activeGroup = groupIndex;
      }
      let stepMs = 0;
      for (let start = 0; start < rows.length; ) {
        const stepStart = performance.now();
        const chunk = rows.slice(start, start + chunkRows);
        const part = encoder.rows(chunk, groupIndex);
        start += chunk.length;
        chunkRows = Math.max(
          1,
          Math.ceil(CHUNK_TEXT_LENGTH / (part.length / chunk.length)),
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
      yield* append(encoder.end(activeGroup));
      if (output === undefined) return inline(context.command, text);
      return {
        command: context.command,
        answer: envelope(context.command, {
          ...summary,
          file: { path: output, bytes, format: format ?? "json" },
        }),
        receipt: { kind: "file", path: output, bytes },
      } satisfies QueryReply;
    }),
  };
});

/** Every typed failure of one run. */
type AnswerFailure =
  | ItemQueryError
  | ItemQueryLayoutError
  | ItemQueryDatabaseError
  | QueryOutputError
  | TargetLibrariesUnavailable;

/**
 * Map the failure of one run to the answer of `command`: every typed failure
 * becomes the envelope, and a defect dies with an `Error`. Cancellation stays
 * an interruption.
 */
function answerFailure(
  command: QueryCliCommand,
  /** The argument that named the Target Libraries, if the caller named them. */
  parameter?: NamedLibraries["parameter"],
) {
  return <R>(
    run: Effect.Effect<QueryReply, AnswerFailure, R>,
  ): Effect.Effect<QueryReply, never, R> =>
    run.pipe(
      Effect.catch((failed) =>
        Effect.sync(() =>
          inline(
            command,
            failure(command, failureDiagnostic(failed, parameter)),
          ),
        ),
      ),
      Effect.catchDefect(dieOfDefect),
    );
}

/** Log a defect of one run and die with an `Error` that wraps it. */
function dieOfDefect(defect: unknown): Effect.Effect<never> {
  logger.error("ZotLit Query failed with a defect", {
    cause: Cause.pretty(Cause.die(defect)),
  });
  return Effect.die(
    new Error("ZotLit Query failed with an internal error.", {
      cause: defect,
    }),
  );
}

function failureDiagnostic(
  failed: AnswerFailure,
  parameter: NamedLibraries["parameter"] | undefined,
): Diagnostic {
  if (failed._tag === "QueryOutputError") return failed.diagnostic;
  if (failed._tag === "TargetLibrariesUnavailable") {
    return targetLibrariesFailure(failed, parameter);
  }
  if (failed._tag === "ItemQueryError") return failed.diagnostic;
  if (failed._tag === "ItemQueryLayoutError") {
    // `@zotlit/db` logs the missing layout and the versions once per copy.
    return diagnostic("unsupported-database-layout", failed.message);
  }
  logger.error("ZotLit Query failed to read the Zotero database", {
    error: failed,
  });
  return diagnostic(
    "database-error",
    `ZotLit Query could not read the Zotero database: ${messageOf(failed.cause)}`,
  );
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

function describeSelector(selector: LibrarySelector): string {
  return selector.type === "group"
    ? `group Library with the group ID ${selector.groupID}`
    : "personal Library";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
