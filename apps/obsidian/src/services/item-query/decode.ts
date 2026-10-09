// Decodes the flat CLI arguments of the Item Query commands, once, in the
// renderer: the query command into a `DecodedQuery` that crosses the
// ZoteroReads worker seam as plain JSON, or into the diagnostic of the first
// malformed argument.
//
// Command, flag, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import { regex } from "arkregex";
import { isAbsolute } from "node:path";
import type { CliData } from "obsidian";
import * as v from "valibot";

import { formatIndexedKey, parseIndexedKey } from "@zotlit/db";
import type { SortSpec } from "@zotlit/item-query";

import { compareSelectors } from "@/services/library-scope/scope";
import type {
  LibraryScope,
  LibrarySelector,
} from "@/services/library-scope/scope";

import {
  DEFAULT_CLI_LIMIT,
  diagnostic,
  ITEM_QUERY_PARAMS,
  QUERY_ID_FORM,
  QUERY_ID_MAX_LENGTH,
} from "./contract";
import type { Diagnostic } from "./contract";

/** The Libraries the caller names, as a scope that needs each of them. */
export interface NamedLibraries {
  scope: LibraryScope;
  /** The argument that names them. */
  parameter: "library" | "libraries" | "item" | "attachment";
}

/**
 * The arguments of one query after decoding. Plain JSON, with no undefined
 * value: it crosses the worker seam as it is. An absent key is an argument
 * the caller omitted.
 */
export interface DecodedQuery {
  kind?: "annotations";
  item?: readonly string[];
  attachment?: readonly string[];
  /** `null`: the Library Scope in force decides. */
  libraries: NamedLibraries | null;
  filter?: string;
  fields?: readonly string[];
  sort?: readonly SortSpec[];
  limit: number | null;
  output?: string;
  /** The id that `zotlit:item-query-cancel` names the query by. */
  id?: string;
}

const GROUP_SELECTOR = regex("^group:([1-9]\\d*)$");
const QUERY_ID = /^[\w.-]+$/;
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const OBSIDIAN_CLI_SWITCHES = ["--copy"] as const;

const librariesSchema = v.pipe(v.array(v.string()), v.minLength(1));
const fieldsSchema = v.array(v.string());
const sortSchema = v.array(
  v.strictObject({
    field: v.string(),
    direction: v.picklist(["asc", "desc"]),
  }),
);

/**
 * Decode the flat arguments of a query, or answer the diagnostic of the first
 * malformed one. Obsidian passes every caller token through, so an undeclared
 * parameter is rejected here too.
 */
export function decodeItemQuery(params: CliData): DecodedQuery | Diagnostic {
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

  const id = params.id;
  if (id !== undefined) {
    const malformed = rejectQueryId(id);
    if (malformed) return malformed;
  }
  return {
    libraries,
    limit,
    ...(filter === undefined ? {} : { filter }),
    ...(fields === undefined ? {} : { fields }),
    ...(sort === undefined ? {} : { sort }),
    ...(output === undefined ? {} : { output }),
    ...(id === undefined ? {} : { id }),
  };
}

/** The schema command takes no parameter: the diagnostic of the first one. */
export function decodeSchemaArguments(params: CliData): Diagnostic | null {
  return rejectParameters(params, []);
}

export function rejectQueryId(id: string): Diagnostic | null {
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
 * every caller token through; its known global switches pass.
 */
export function rejectParameters(
  params: CliData,
  accepted: readonly string[],
): Diagnostic | null {
  for (const key of Object.keys(params)) {
    if (accepted.includes(key)) continue;
    if (key.startsWith("--")) {
      if (OBSIDIAN_CLI_SWITCHES.some((switchName) => switchName === key)) {
        continue;
      }
      const parameter = key.slice(2);
      if (accepted.includes(parameter)) {
        return {
          ...invalid(
            key,
            `Parameter '${key}' is not valid: use ${parameter}=<value>.`,
          ),
          hint: `Run the command with ${parameter}=<value>, without --.`,
        };
      }
      return {
        ...invalid(
          key,
          accepted.length === 0
            ? `Unknown parameter '${key}': this command takes no parameters.`
            : `Unknown parameter '${key}': use ${accepted.map((name) => `${name}=<value>`).join(", ")}.`,
        ),
        hint:
          accepted.length === 0
            ? `Remove '${key}'; this command takes no parameters.`
            : "Use a supported parameter as name=value, without --; see the command help for its parameters.",
      };
    }
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

export function invalid(parameter: string, message: string): Diagnostic {
  return diagnostic("invalid-argument", message, { details: { parameter } });
}

/** Annotation selectors share the query decoder and infer their own Libraries. */
export function decodeAnnotationQuery(
  params: CliData,
): DecodedQuery | Diagnostic {
  const rejected = rejectParameters(params, [
    ...ITEM_QUERY_PARAMS,
    "item",
    "attachment",
  ]);
  if (rejected) return rejected;
  const { item, attachment, ...common } = params;
  const decoded = decodeItemQuery(common);
  if ("code" in decoded) return decoded;
  const selected: Partial<Record<"item" | "attachment", string[]>> = {};
  const libraries = new Map<string, LibrarySelector>();
  let parameter: "item" | "attachment" | undefined;
  for (const [name, raw] of [
    ["item", item],
    ["attachment", attachment],
  ] as const) {
    if (raw === undefined) continue;
    parameter ??= name;
    if (params.library !== undefined || params.libraries !== undefined)
      return invalid(
        name,
        "An Indexed Key selects its Library. Omit library and libraries beside Item or Attachment keys.",
      );
    let texts: unknown = raw;
    if (raw.startsWith("[")) {
      try {
        texts = JSON.parse(raw);
      } catch {
        return invalid(
          name,
          `${name} must be an Indexed Key or a JSON array of Indexed Keys.`,
        );
      }
    } else texts = [raw];
    if (!Array.isArray(texts) || !texts.length)
      return invalid(name, `${name} needs at least one Indexed Key.`);
    const keys: string[] = [];
    for (const text of texts) {
      const key = typeof text === "string" ? parseIndexedKey(text) : null;
      if (!key || (key.groupID !== null && key.groupID <= 0))
        return invalid(name, `${name} contains an invalid Indexed Key.`);
      keys.push(formatIndexedKey(key.key, key.groupID));
      libraries.set(
        String(key.groupID),
        key.groupID === null
          ? { type: "personal" }
          : { type: "group", groupID: key.groupID },
      );
    }
    selected[name] = [...new Set(keys)];
  }
  return {
    ...decoded,
    kind: "annotations",
    ...selected,
    ...(parameter
      ? {
          libraries: {
            scope: {
              mode: "selected" as const,
              libraries: [...libraries.values()].toSorted(compareSelectors),
            },
            parameter,
          },
        }
      : {}),
  };
}
