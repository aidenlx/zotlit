// The names, parameters, and defaults of the Item Query commands: the
// constants that the handlers run and the guide prints.
//
// Command, flag, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import type { CliFlag, CliFlags } from "obsidian";

export const ITEM_QUERY_COMMAND = "zotlit:item-query" as const;
export const ITEM_QUERY_SCHEMA_COMMAND = "zotlit:item-query-schema" as const;
export const ITEM_QUERY_GUIDE_COMMAND = "zotlit:item-query-guide" as const;

export type ItemQueryCommand =
  | typeof ITEM_QUERY_COMMAND
  | typeof ITEM_QUERY_SCHEMA_COMMAND
  | typeof ITEM_QUERY_GUIDE_COMMAND;

/** The rows a CLI query returns when the caller gives no limit. */
export const DEFAULT_CLI_LIMIT = 100;

export const ITEM_QUERY_PARAMS = [
  "filter",
  "fields",
  "sort",
  "limit",
  "library",
  "libraries",
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
} satisfies Record<ItemQueryParam, CliFlag>;

/**
 * The diagnostic codes this adapter raises itself, each defined with the
 * recovery action its diagnostic carries. An invalid query keeps the code and
 * hint of its `ItemQueryError`.
 */
export const DIAGNOSTIC_HINTS = {
  "invalid-argument":
    "Correct the parameter named in details.parameter, then run the command again.",
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
