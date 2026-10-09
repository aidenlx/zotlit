// Decodes the flat CLI arguments of the ZotLit Query commands, once, in the
// renderer: the query command into a `DecodedQuery` that crosses the
// ZoteroReads worker seam as plain JSON, or into the diagnostic of the first
// malformed argument.
//
// Command, flag, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import { isAbsolute } from "node:path";
import type { CliData } from "obsidian";
import * as v from "valibot";

import { formatIndexedKey, parseIndexedKey } from "@zotlit/db";
import { UNLIMITED_LIMIT } from "@zotlit/item-query";

import {
  cliNotApplicable,
  cliParams,
  cliText,
  cliVariants,
  decodeCliParams,
} from "@/lib/cli-params";
import type { CliParamName, CliRequest } from "@/lib/cli-params";
import {
  compareSelectors,
  selectorKey,
  selectorKeySchema,
} from "@/services/library-scope/scope";
import type {
  LibraryScope,
  LibrarySelector,
} from "@/services/library-scope/scope";

import {
  DEFAULT_CLI_LIMIT,
  QUERY_CANCEL_COMMAND,
  QUERY_COMMAND,
  QUERY_GUIDE_COMMAND,
  QUERY_SCHEMA_COMMAND,
  QUERY_ID_FORM,
  QUERY_ID_MAX_LENGTH,
} from "./contract";
import { GUIDE_TOPIC_NAMES } from "./guide";
import type { GuideTopic } from "./guide";

export { rejectionDiagnostic } from "./contract";

/** The Libraries the caller names, as a scope that needs each of them. */
export interface NamedLibraries {
  scope: LibraryScope;
  /** The argument that names them. */
  parameter: "library" | "item" | "attachment";
}

const QUERY_ID = /^[\w.-]+$/;
const POSITIVE_INTEGER = /^[1-9]\d*$/;

const notQueryId = (issue: { input: unknown }) =>
  `id '${String(issue.input)}' is not a query id: use ${QUERY_ID_FORM}.`;

const queryId = v.pipe(
  v.string(),
  v.maxLength(QUERY_ID_MAX_LENGTH, notQueryId),
  v.regex(QUERY_ID, notQueryId),
);

/**
 * A parameter that carries JSON. Text that is no JSON answers its own
 * message; valid JSON keeps the first issue raised by `schema`.
 */
function jsonParameter<TSchema extends v.GenericSchema>(
  parameter: string,
  expected: string,
  schema: TSchema,
) {
  return v.pipe(
    v.string(),
    v.parseJson(undefined, `${parameter} is not valid JSON: use ${expected}.`),
    schema,
  );
}

/** Split a comma list only outside quotes and bracketed Projection Paths. */
function splitList(text: string): { value: string; start: number }[] {
  const parts: { value: string; start: number }[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "[") depth++;
    else if (char === "]") depth--;
    else if (char === "," && depth === 0) {
      parts.push({ value: text.slice(start, index).trim(), start });
      start = index + 1;
    }
  }
  parts.push({ value: text.slice(start).trim(), start });
  return parts;
}

const commaList = v.pipe(
  v.string(),
  v.rawCheck<string>(({ dataset, addIssue }) => {
    if (!dataset.typed) return;
    const parts = splitList(dataset.value);
    const empty = parts.findIndex(({ value }) => value === "");
    if (empty !== -1)
      addIssue({
        message: `List element ${empty + 1} is empty at position ${parts[empty]!.start + 1}. Give a value between commas.`,
        path: [
          {
            type: "array",
            origin: "value",
            input: parts.map(({ value }) => value),
            key: empty,
            value: "",
          },
        ],
      });
  }),
  v.transform((text) => splitList(text).map(({ value }) => value)),
);

function listParameter<TSchema extends v.GenericSchema>(
  parameter: string,
  expected: string,
  schema: TSchema,
) {
  return v.pipe(
    v.lazy((input) =>
      typeof input === "string" && input.trimStart().startsWith("[")
        ? jsonParameter(parameter, expected, v.unknown())
        : commaList,
    ),
    schema,
  );
}

/** One library argument names one or more Target Libraries. */
const library = v.lazy((input) =>
  input === "all"
    ? v.pipe(
        v.literal("all"),
        v.transform((): LibraryScope => ({ mode: "all" })),
      )
    : listParameter(
        "library",
        "a JSON array of Library selectors",
        v.pipe(
          v.array(
            selectorKeySchema(
              (text) =>
                `'${text}' is not a Library: use personal or group:<groupID>.`,
            ),
          ),
          v.minLength(1),
          v.check(
            (selectors) => !firstRepeat(selectors),
            (issue) =>
              `library names '${firstRepeat(issue.input)}' twice: name each Library once.`,
          ),
          v.transform(
            (selectors): LibraryScope => ({
              mode: "selected",
              libraries: selectors.toSorted(compareSelectors),
            }),
          ),
        ),
      ),
);

const from = v.picklist(
  ["items", "annotations"],
  (issue) =>
    `from '${String(issue.input)}' is not a Query Dataset: use items, annotations.`,
);

/** The key of the first selector `selectors` names twice. */
function firstRepeat(
  selectors: readonly LibrarySelector[],
): string | undefined {
  const seen = new Set<string>();
  for (const selector of selectors) {
    const key = selectorKey(selector);
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return undefined;
}

const notPositiveInteger = (issue: { input: unknown }) =>
  `limit '${String(issue.input)}' is not a positive integer: use a positive integer, or all for every match.`;

const limit = v.lazy((input) =>
  input === UNLIMITED_LIMIT
    ? v.pipe(
        v.literal(UNLIMITED_LIMIT),
        v.transform(() => null),
      )
    : v.pipe(
        v.string(),
        v.regex(POSITIVE_INTEGER, notPositiveInteger),
        v.check(
          (text) => Number.isSafeInteger(Number(text)),
          notPositiveInteger,
        ),
        v.transform(Number),
      ),
);

/** The arguments every query takes, whichever Libraries it reads. */
const queryOptions = {
  from: v.optional(from, "items"),
  filter: v.optional(
    cliText(
      "filter is empty: give a Filter Expression, or omit filter to match every row in the dataset.",
    ),
  ),
  fields: v.optional(
    listParameter(
      "fields",
      "a JSON array of Projection Path strings",
      v.array(v.string()),
    ),
  ),
  sort: v.optional(
    v.pipe(
      v.lazy((input) =>
        typeof input === "string" && input.trimStart().startsWith("[")
          ? jsonParameter(
              "sort",
              'a JSON array of {"field","direction"} objects with direction "asc" or "desc"',
              v.unknown(),
            )
          : v.pipe(
              commaList,
              v.transform((parts) =>
                parts.map((part) => ({
                  field:
                    part.startsWith("-") || part.startsWith("+")
                      ? part.slice(1)
                      : part,
                  direction: part.startsWith("-")
                    ? ("desc" as const)
                    : ("asc" as const),
                })),
              ),
            ),
      ),
      v.array(
        v.strictObject({
          field: cliText("Give a Sortable Field after the sort sign."),
          direction: v.picklist(["asc", "desc"]),
        }),
      ),
    ),
  ),
  limit: v.optional(limit, String(DEFAULT_CLI_LIMIT)),
  output: v.optional(
    v.pipe(
      v.string(),
      v.check(
        (output) => isAbsolute(output) && !output.includes("\0"),
        "output must be an absolute path to a new JSON file.",
      ),
    ),
  ),
  id: v.optional(queryId),
};

/**
 * The arguments of one query after decoding. Plain JSON, with no undefined
 * value: it crosses the worker seam as it is. An absent key is an argument
 * the caller omitted; `libraries: null` leaves the Libraries to the Library
 * Scope in force.
 */
function decodedQuery(
  options: v.InferOutput<v.StrictObjectSchema<typeof queryOptions, undefined>>,
  libraries: NamedLibraries | null,
) {
  const { from, filter, fields, sort, limit, output, id } = options;
  return {
    from,
    libraries,
    limit,
    ...(filter === undefined ? {} : { filter }),
    ...(fields === undefined ? {} : { fields }),
    ...(sort === undefined ? {} : { sort }),
    ...(output === undefined ? {} : { output }),
    // The id that `zotlit:query-cancel` names the query by.
    ...(id === undefined ? {} : { id }),
  };
}

const queryVariants = {
  library: v.pipe(
    cliParams({ library, ...queryOptions }),
    v.transform(({ library: scope, ...options }) =>
      decodedQuery(options, { scope, parameter: "library" }),
    ),
  ),
  scope: v.pipe(
    cliParams(queryOptions),
    v.transform((options) => decodedQuery(options, null)),
  ),
};
const queryVariant = (params: CliData) =>
  params.library !== undefined ? "library" : "scope";

/** The schema command optionally narrows its live dataset listing. */
export function decodeSchemaArguments(params: CliData) {
  return decodeCliParams(params, cliParams({ from: v.optional(from) }), {
    command: QUERY_SCHEMA_COMMAND,
  });
}

const guideParams = v.pipe(
  cliParams({
    topic: v.optional(
      v.picklist(
        GUIDE_TOPIC_NAMES,
        (issue) =>
          `topic '${String(issue.input)}' is not a guide topic: use ${GUIDE_TOPIC_NAMES.join(", ")}.`,
      ),
    ),
  }),
  v.transform(({ topic }) => topic ?? null),
);

/** The guide topic, or `null` for the quickstart. */
export function decodeGuideArguments(
  params: CliData,
): CliRequest<GuideTopic | null> {
  return decodeCliParams(params, guideParams, {
    command: QUERY_GUIDE_COMMAND,
  });
}

const cancelParams = v.pipe(
  cliParams(
    { id: queryId },
    { id: "id is missing: give the id of the query to cancel, as in id=<id>." },
  ),
  v.transform(({ id }) => id),
);

/** The id of the query to cancel. */
export function decodeCancelArguments(params: CliData): CliRequest<string> {
  return decodeCliParams(params, cancelParams, {
    command: QUERY_CANCEL_COMMAND,
  });
}

const indexedKey = v.pipe(
  v.string(),
  v.check((text) => {
    const key = parseIndexedKey(text);
    return key !== null && (key.groupID === null || key.groupID > 0);
  }, "Use a valid Indexed Key."),
  v.transform((text) => {
    const key = parseIndexedKey(text)!;
    return formatIndexedKey(key.key, key.groupID);
  }),
);
const annotationSelector = (name: string) =>
  v.lazy((input) =>
    typeof input === "string" && input.startsWith("[")
      ? jsonParameter(
          name,
          "a nonempty JSON array of Indexed Keys",
          v.pipe(v.array(indexedKey), v.minLength(1)),
        )
      : v.pipe(
          indexedKey,
          v.transform((key) => [key]),
        ),
  );
const queryParams = cliVariants(
  (params) =>
    params.from === "annotations" &&
    (params.item !== undefined || params.attachment !== undefined)
      ? "selectors"
      : queryVariant(params),
  {
    ...queryVariants,
    selectors: v.pipe(
      cliParams({
        item: v.optional(annotationSelector("item")),
        attachment: v.optional(annotationSelector("attachment")),
        library: cliNotApplicable(
          "An Indexed Key selects its Library. Omit library beside Item or Attachment keys.",
        ),
        ...queryOptions,
      }),
      v.transform(({ item, attachment, library: _, ...options }) => {
        const selected = new Map<string, LibrarySelector>();
        for (const text of [...(item ?? []), ...(attachment ?? [])]) {
          const key = parseIndexedKey(text)!;
          selected.set(
            String(key.groupID),
            key.groupID === null
              ? { type: "personal" }
              : { type: "group", groupID: key.groupID },
          );
        }
        return {
          ...decodedQuery(options, {
            scope: {
              mode: "selected",
              libraries: [...selected.values()].toSorted(compareSelectors),
            },
            parameter: item !== undefined ? "item" : "attachment",
          }),
          ...(item === undefined ? {} : { item: [...new Set(item)] }),
          ...(attachment === undefined
            ? {}
            : { attachment: [...new Set(attachment)] }),
        };
      }),
    ),
  },
);

/** The decoded query crosses the worker seam as plain JSON. */
export type DecodedQuery = v.InferOutput<typeof queryParams> & {
  readonly item?: string[];
  readonly attachment?: string[];
};
export type QueryParam = CliParamName<typeof queryParams>;

export function decodeQuery(params: CliData): CliRequest<DecodedQuery> {
  const request = decodeCliParams(params, queryParams, {
    command: QUERY_COMMAND,
  });
  if (request.kind === "invalid" && request.parameter === "libraries") {
    return {
      ...request,
      hint: "Use library=<list|all> to select the Target Libraries.",
    };
  }
  if (request.kind === "invalid" && request.issue) {
    const { parameter, issue } = request;
    const input = params[parameter];
    const index = issue.keys?.[0];
    if (
      ["fields", "sort", "library"].includes(parameter) &&
      input !== undefined &&
      !input.trimStart().startsWith("[") &&
      typeof index === "number"
    ) {
      const part = splitList(input)[index];
      if (part?.value === "") {
        // Keep the list element index and the UTF-16 character span distinct.
        return {
          ...request,
          issue: { ...issue, span: { from: part.start, to: part.start } },
        };
      }
    }
  }
  return request;
}
