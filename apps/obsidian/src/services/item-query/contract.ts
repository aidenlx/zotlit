// The names, parameters, and defaults of the ZotLit Query commands: the
// constants that the handlers run and the guide prints.
//
// Command, flag, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import type { CliFlag, CliFlags } from "obsidian";

import { diagnoseDecode, renderDiagnostic } from "@zotlit/item-query";
import type {
  Diagnostic as QueryDiagnostic,
  ItemQueryError,
  QuerySummary,
  QueryGroup,
  SchemaCustomField,
  SortSpec,
} from "@zotlit/item-query";

import { createCliDiagnostics } from "@/lib/cli-diagnostic";
import type { CliRejection } from "@/lib/cli-params";
import type { WorkbenchIdentity } from "@/services/template-workbench/envelope";
import type { SchemaAsset } from "@/services/template-workbench/schema";

import contractVersion from "./contract-version.json" with { type: "json" };
import type { QueryParam } from "./decode";

/**
 * The wire format of the ZotLit Query commands, versioned on its own (ADR 0065):
 * it evolves independently from the Template Contract.
 */
export const CONTRACT_VERSION = contractVersion.contractVersion;

export const QUERY_COMMAND = "zotlit:query" as const;
export const QUERY_CANCEL_COMMAND = "zotlit:query-cancel" as const;
export const QUERY_SCHEMA_COMMAND = "zotlit:query-schema" as const;
export const QUERY_GUIDE_COMMAND = "zotlit:query-guide" as const;

export type QueryCliCommand =
  | typeof QUERY_COMMAND
  | typeof QUERY_CANCEL_COMMAND
  | typeof QUERY_SCHEMA_COMMAND
  | typeof QUERY_GUIDE_COMMAND;

/** The rows a CLI query returns when the caller gives no limit. */
export const DEFAULT_CLI_LIMIT = 100;
/** Bounds the string transferred through Obsidian's renderer and CLI. */
export const INLINE_MAX_BYTES = 1024 * 1024;
export const QUERY_ID_MAX_LENGTH = 128;
/** The form of a query id, as the help, the guide, and the diagnostic state it. */
export const QUERY_ID_FORM = `1 to ${QUERY_ID_MAX_LENGTH} ASCII letters, digits, ., _, or -`;

/** The text a cancelled query rejects with; Obsidian prints it after "Error: ". */
export function queryCancelledText(id: string): string {
  return `The query '${id}' was cancelled by ${QUERY_CANCEL_COMMAND}.`;
}

export const queryFlags = {
  from: {
    value: "<items|attachments|annotations>",
    description: "Query Dataset to read (default: items)",
  },
  filter: {
    value: "<expression>",
    description:
      "Filter Expression that selects rows; omit it to match every row in the dataset",
  },
  fields: {
    value: "<list|json>",
    description:
      "Comma list or JSON array of Projection Paths, such as title,date.year; [] returns only row identities",
  },
  sort: {
    value: "<list|json>",
    description:
      'Comma list: -field descending, +field or field ascending; or a JSON array of {"field","direction"}',
  },
  group: {
    value: "<path>",
    description:
      "Group by one scalar Projection Path; limit applies inside each group",
  },
  limit: {
    value: "<n|all>",
    description: `Most rows to return: a positive integer, or all (default ${DEFAULT_CLI_LIMIT})`,
  },
  library: {
    value: "<list|all>",
    description:
      "Target Libraries: personal, group:<groupID>, a comma list or JSON array, or all (default: Library scope)",
  },
  output: {
    value: "<absolute-path>",
    description:
      "Write the complete JSON response to a new file and return its path and counts",
  },
  id: {
    value: "<id>",
    description: `Name this query so that ${QUERY_CANCEL_COMMAND} can stop it: ${QUERY_ID_FORM}`,
  },
} satisfies Record<QueryParam, CliFlag>;

export const queryCancelFlags: CliFlags = {
  id: {
    value: "<id>",
    description: `The id of a running ${QUERY_COMMAND} call in this vault`,
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
  "query-id-in-use": `Give this query another id. A query with this id is still running in this vault; the id is free again when that query finishes or is cancelled with ${QUERY_CANCEL_COMMAND}.`,
  "source-unavailable":
    "Run the command again once the connected Zotero source is readable; when the message reports a failure, ask the user to check the plugin log.",
  "library-not-found":
    "Use personal, or group:<groupID> with the group ID of a group Library that the connected Zotero source holds; library=all reads every Library of the source.",
  "no-library-available":
    "Name the Libraries with library=<list> or use library=all; to change the default, ask the user to select an available Library in the Library scope setting of ZotLit.",
  "database-error":
    "Run the command again; if it fails again, ask the user to check the plugin log.",
  "unsupported-database-layout":
    "Ask the user to update ZotLit: this ZotLit version cannot read the way their Zotero version stores its data. Running the command again gives the same result until then.",
} as const satisfies Record<string, string>;

type AdapterDiagnosticCode = keyof typeof DIAGNOSTIC_HINTS;

/** The failure of an Item Query command, as its envelope carries it. */
export interface Diagnostic extends QueryDiagnostic<
  AdapterDiagnosticCode | ItemQueryError["code"]
> {
  details?: { parameter: string };
}

const base = createCliDiagnostics<
  typeof DIAGNOSTIC_HINTS,
  Diagnostic["details"]
>(DIAGNOSTIC_HINTS, "invalid-argument");

export function diagnostic(
  code: AdapterDiagnosticCode,
  message: string,
  details?: Diagnostic["details"],
): Diagnostic {
  const value = base.diagnostic(code, message, details);
  return { ...value, ...renderDiagnostic(value) };
}

export function rejectionDiagnostic(rejection: CliRejection): Diagnostic {
  const value = base.rejectionDiagnostic(rejection);
  return { ...value, ...diagnoseDecode(rejection, value.hint) };
}

/** A Target Library on the wire: local `libraryID` values stay inside. */
export type LibraryWire =
  | { type: "personal" }
  | { type: "group"; groupID: number; name: string };

export type EnvelopeTail =
  | { ok: false; diagnostic: Diagnostic }
  | {
      ok: true;
      identity: WorkbenchIdentity;
      libraries: readonly LibraryWire[];
      request: object;
      returnedCount: number;
      totalCount?: number;
      groups?: readonly QueryGroup[];
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
      datasets: Partial<
        Record<
          "items" | "annotations",
          { fields: readonly string[]; customPrefix: string }
        >
      >;
      defaults: Partial<
        Record<
          "items" | "annotations",
          {
            fields: readonly string[];
            sort: readonly SortSpec[];
            limit: number;
            library: { source: "library-scope" };
          }
        >
      >;
    }
  | {
      ok: true;
      id: string;
      /** `false`: no query with this id was running in this vault. */
      cancelRequested: boolean;
    };

/** The pretty JSON of the versioned envelope of `command`. */
export function envelope(command: QueryCliCommand, tail: EnvelopeTail): string {
  return JSON.stringify(
    { contractVersion: CONTRACT_VERSION, command, ...tail },
    null,
    2,
  );
}

export function failure(
  command: QueryCliCommand,
  diagnostic: Diagnostic,
): string {
  return envelope(command, { ok: false, diagnostic });
}

/** The answer of a query whose id names a query that is still running. */
export function queryIdInUseFailure(
  id: string,
  command: QueryCliCommand,
): string {
  return failure(
    command,
    diagnostic(
      "query-id-in-use",
      `A query with the id '${id}' is running in this vault.`,
      { parameter: "id" },
    ),
  );
}
