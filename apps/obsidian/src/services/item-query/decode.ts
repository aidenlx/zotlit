// Decodes the flat CLI arguments of the Item Query commands, once, in the
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
  cliMaybeEmpty,
  cliNotApplicable,
  cliParams,
  cliText,
  cliVariants,
  decodeCliParams,
  noCliParams,
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

import { ANNOTATION_GUIDE_TOPIC_NAMES } from "./annotation-guide";
import {
  ANNOTATION_QUERY_COMMAND,
  ANNOTATION_QUERY_GUIDE_COMMAND,
  DEFAULT_CLI_LIMIT,
  ITEM_QUERY_CANCEL_COMMAND,
  ITEM_QUERY_COMMAND,
  ITEM_QUERY_GUIDE_COMMAND,
  QUERY_ID_FORM,
  QUERY_ID_MAX_LENGTH,
} from "./contract";
import type { ItemQueryCommand } from "./contract";
import { GUIDE_TOPIC_NAMES } from "./guide";
import type { GuideTopic } from "./guide";

export { rejectionDiagnostic } from "./contract";

/** The Libraries the caller names, as a scope that needs each of them. */
export interface NamedLibraries {
  scope: LibraryScope;
  /** The argument that names them. */
  parameter: "library" | "libraries" | "item" | "attachment";
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

/** `libraries`: the word `all`, or a JSON array of selector texts. */
const libraries = v.lazy((input) =>
  input === "all"
    ? v.pipe(
        v.literal("all"),
        v.transform((): LibraryScope => ({ mode: "all" })),
      )
    : jsonParameter(
        "libraries",
        'all, or a JSON array of at least one Library, each "personal" or "group:<groupID>"',
        v.pipe(
          v.array(
            selectorKeySchema(
              (text) =>
                `'${text}' in libraries is not a Library: use "personal" or "group:<groupID>".`,
            ),
          ),
          v.minLength(1),
          v.check(
            (selectors) => !firstRepeat(selectors),
            (issue) =>
              `libraries names '${firstRepeat(issue.input)}' twice: name each Library once.`,
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

const library = selectorKeySchema(
  (text) => `'${text}' is not a Library: use personal or group:<groupID>.`,
);

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
  filter: v.optional(
    cliText(
      "filter is empty: give a Filter Expression, or omit filter to match every Item.",
    ),
  ),
  fields: v.optional(
    jsonParameter(
      "fields",
      "a JSON array of Projection Path strings",
      v.array(v.string()),
    ),
  ),
  sort: v.optional(
    jsonParameter(
      "sort",
      'a JSON array of {"field","direction"} objects with direction "asc" or "desc"',
      v.array(
        v.strictObject({
          field: v.string(),
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
  const { filter, fields, sort, limit, output, id } = options;
  return {
    libraries,
    limit,
    ...(filter === undefined ? {} : { filter }),
    ...(fields === undefined ? {} : { fields }),
    ...(sort === undefined ? {} : { sort }),
    ...(output === undefined ? {} : { output }),
    // The id that `zotlit:item-query-cancel` names the query by.
    ...(id === undefined ? {} : { id }),
  };
}

const queryVariant = ({ libraries, library }: CliData) =>
  libraries !== undefined
    ? "libraries"
    : library !== undefined
      ? "library"
      : "scope";
const queryVariants = {
  libraries: v.pipe(
    // `libraries` wins over `library`, which this variant reads no further.
    cliParams({
      libraries,
      library: cliMaybeEmpty(),
      ...queryOptions,
    }),
    v.transform(({ libraries: scope, library: _, ...options }) =>
      decodedQuery(options, { scope, parameter: "libraries" }),
    ),
  ),
  library: v.pipe(
    cliParams({ library, ...queryOptions }),
    v.transform(({ library: selector, ...options }) =>
      decodedQuery(options, {
        scope: { mode: "selected", libraries: [selector] },
        parameter: "library",
      }),
    ),
  ),
  scope: v.pipe(
    cliParams(queryOptions),
    v.transform((options) => decodedQuery(options, null)),
  ),
};
const queryParams = cliVariants(queryVariant, queryVariants);

export type DecodedItemQuery = v.InferOutput<typeof queryParams>;
/**
 * The decoded arguments of either query command. The Annotation selectors
 * are optional keys, so a reader takes both datasets in one shape.
 */
export type DecodedQuery = (DecodedItemQuery | DecodedAnnotationQuery) & {
  readonly item?: string[];
  readonly attachment?: string[];
};

/** The parameters of `zotlit:item-query`, to type its `CliFlags`. */
export type ItemQueryParam = CliParamName<typeof queryParams>;

/** Decode the flat arguments of a query, or answer the first malformed one. */
export function decodeItemQuery(params: CliData): CliRequest<DecodedItemQuery> {
  return decodeCliParams(params, queryParams, { command: ITEM_QUERY_COMMAND });
}

/** The schema command `command` takes no parameter. */
export function decodeSchemaArguments(
  params: CliData,
  command: ItemQueryCommand,
): CliRequest<object> {
  return decodeCliParams(params, noCliParams, { command });
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
    command: ITEM_QUERY_GUIDE_COMMAND,
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
    command: ITEM_QUERY_CANCEL_COMMAND,
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
const annotationParams = cliVariants(
  (params) =>
    params.item !== undefined || params.attachment !== undefined
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
        libraries: cliNotApplicable(
          "An Indexed Key selects its Library. Omit libraries beside Item or Attachment keys.",
        ),
        ...queryOptions,
      }),
      v.transform(
        ({ item, attachment, library: _, libraries: __, ...options }) => {
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
        },
      ),
    ),
  },
);

export type DecodedAnnotationQuery = v.InferOutput<typeof annotationParams>;
export type AnnotationQueryParam = CliParamName<typeof annotationParams>;

export function decodeAnnotationQuery(
  params: CliData,
): CliRequest<DecodedAnnotationQuery> {
  return decodeCliParams(params, annotationParams, {
    command: ANNOTATION_QUERY_COMMAND,
  });
}

const annotationGuideParams = v.pipe(
  cliParams({ topic: v.optional(v.picklist(ANNOTATION_GUIDE_TOPIC_NAMES)) }),
  v.transform(({ topic }) => topic ?? null),
);
export function decodeAnnotationGuideArguments(params: CliData) {
  return decodeCliParams(params, annotationGuideParams, {
    command: ANNOTATION_QUERY_GUIDE_COMMAND,
  });
}
