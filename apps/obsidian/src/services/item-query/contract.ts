// The names, parameters, and defaults of the Item Query commands: the
// constants that the handlers run and the guide prints.
//
// Command, flag, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import type { CliFlag, CliFlags } from "obsidian";

import type { ItemQueryError } from "@zotlit/item-query";

export const ANNOTATION_QUERY_SCHEMA_COMMAND =
  "zotlit:annotation-query-schema" as const;
export const ANNOTATION_QUERY_COMMAND = "zotlit:annotation-query" as const;

export const ITEM_QUERY_COMMAND = "zotlit:item-query" as const;
export const ITEM_QUERY_CANCEL_COMMAND = "zotlit:item-query-cancel" as const;
export const ITEM_QUERY_SCHEMA_COMMAND = "zotlit:item-query-schema" as const;
export const ITEM_QUERY_GUIDE_COMMAND = "zotlit:item-query-guide" as const;

export type ItemQueryCommand =
  | typeof ANNOTATION_QUERY_SCHEMA_COMMAND
  | typeof ANNOTATION_QUERY_COMMAND
  | typeof ITEM_QUERY_COMMAND
  | typeof ITEM_QUERY_CANCEL_COMMAND
  | typeof ITEM_QUERY_SCHEMA_COMMAND
  | typeof ITEM_QUERY_GUIDE_COMMAND;

/** The rows a CLI query returns when the caller gives no limit. */
export const DEFAULT_CLI_LIMIT = 100;
/** Bounds the string transferred through Obsidian's renderer and CLI. */
export const INLINE_MAX_BYTES = 1024 * 1024;
export const QUERY_ID_MAX_LENGTH = 128;
/** The form of a query id, as the help, the guide, and the diagnostic state it. */
export const QUERY_ID_FORM = `1 to ${QUERY_ID_MAX_LENGTH} ASCII letters, digits, ., _, or -`;

/** The text a cancelled query rejects with; Obsidian prints it after "Error: ". */
export function queryCancelledText(id: string): string {
  return `The query '${id}' was cancelled by ${ITEM_QUERY_CANCEL_COMMAND}.`;
}

export const ITEM_QUERY_PARAMS = [
  "filter",
  "fields",
  "sort",
  "limit",
  "library",
  "libraries",
  "output",
  "id",
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
    description: `Most rows to return: a positive integer, or all (default ${DEFAULT_CLI_LIMIT})`,
  },
  library: {
    value: "<personal|group:id>",
    description:
      "One Library to read: personal, or group:<groupID>; libraries overrides it",
  },
  libraries: {
    value: "<json|all>",
    description:
      'Libraries to read as one result set: a JSON array such as ["personal","group:123"], or all for every Library (default: the available Libraries of the Library scope setting)',
  },
  output: {
    value: "<absolute-path>",
    description:
      "Write the complete JSON response to a new file and return its path and counts",
  },
  id: {
    value: "<id>",
    description: `Name this query so that ${ITEM_QUERY_CANCEL_COMMAND} can stop it: ${QUERY_ID_FORM}`,
  },
} satisfies Record<ItemQueryParam, CliFlag>;

export const itemQueryCancelFlags: CliFlags = {
  id: {
    value: "<id>",
    description: `The id of a running ${ITEM_QUERY_COMMAND} call in this vault`,
  },
} satisfies Record<"id", CliFlag>;

/**
 * The diagnostic codes this adapter raises itself, each defined with the
 * recovery action its diagnostic carries. An invalid query keeps the code and
 * hint of its `ItemQueryError`.
 */
export const DIAGNOSTIC_HINTS = {
  "result-too-large":
    "Run the query with output=<absolute-path> to write the complete response to a new JSON file, or reduce the fields or limit.",
  "output-error":
    "Use an absolute output path in an existing writable directory, with a filename that does not exist.",
  "invalid-argument":
    "Correct the parameter named in details.parameter, then run the command again.",
  "query-id-in-use": `Give this query another id. A query with this id is still running in this vault; the id is free again when that query finishes or is cancelled with ${ITEM_QUERY_CANCEL_COMMAND}.`,
  "source-unavailable":
    "Run the command again once the connected Zotero source is readable; when the message reports a failure, ask the user to check the plugin log.",
  "library-not-found":
    "Use personal, or group:<groupID> with the group ID of a group Library that the connected Zotero source holds; libraries=all reads every Library of the source.",
  "no-library-available":
    "Name the Libraries with libraries=<JSON array> or use libraries=all; to change the default, ask the user to select an available Library in the Library scope setting of ZotLit.",
  "database-error":
    "Run the command again; if it fails again, ask the user to check the plugin log.",
  "unsupported-database-layout":
    "Ask the user to update ZotLit: this ZotLit version cannot read the way their Zotero version stores its data. Running the command again gives the same result until then.",
} as const satisfies Record<string, string>;

type AdapterDiagnosticCode = keyof typeof DIAGNOSTIC_HINTS;

/** The failure of an Item Query command, as its envelope carries it. */
export interface Diagnostic {
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

export const annotationQueryFlags: CliFlags = {
  ...itemQueryFlags,
  item: {
    value: "<indexed-key|json>",
    description:
      "Item Indexed Key or JSON array of Item keys; selects their Libraries",
  },
  attachment: {
    value: "<indexed-key|json>",
    description:
      "Attachment Indexed Key or JSON array of Attachment keys; selects their Libraries",
  },
};
