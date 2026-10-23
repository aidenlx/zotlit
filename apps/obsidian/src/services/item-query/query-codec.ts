// The requests the ZoteroReads worker answers for the Query commands, as the
// codecs they cross the worker seam through (`zotero-reads/rpc.ts`). The
// renderer decodes them from the CLI in `decode.ts`.

import { nameDictionary } from "@zotlit/item-query";
import type { NameDictionary } from "@zotlit/item-query";
import { DELIMITED_FORMATS } from "@zotlit/shared/delimited";

import { Predicate, Schema, SchemaGetter } from "@/lib/effect";
import { libraryScopeWire } from "@/services/library-scope/scope";

export const QUERY_DATASETS = ["items", "attachments", "annotations"] as const;

/** The Libraries the caller names, as a scope that needs each of them. */
const NamedLibraries = Schema.Struct({
  scope: libraryScopeWire,
  /** The argument that names them. */
  parameter: Schema.Literal("library"),
});
export type NamedLibraries = typeof NamedLibraries.Type;

/**
 * Formula names come from the caller's text: they cross as a plain record and
 * arrive as a dictionary without a prototype, so a Formula named __proto__
 * stays a Formula.
 */
const Formulas = Schema.declare(
  (input: unknown): input is Readonly<Record<string, string>> =>
    Predicate.isObject(input) &&
    Object.values(input).every((text) => typeof text === "string"),
).pipe(
  Schema.decodeTo(
    Schema.declare((input: unknown): input is NameDictionary<string> =>
      Predicate.isObject(input),
    ),
    {
      decode: SchemaGetter.transform((record) =>
        nameDictionary(Object.entries(record)),
      ),
      encode: SchemaGetter.transform((dictionary) => ({ ...dictionary })),
    },
  ),
);

/**
 * The arguments of one query after decoding: the codec it crosses the
 * ZoteroReads worker seam through (`zotero-reads/rpc.ts`). An absent key is
 * an argument the caller omitted; `libraries: null` leaves the Libraries to
 * the Library Scope in force.
 */
export const DecodedQuery = Schema.Struct({
  from: Schema.Literals(QUERY_DATASETS),
  libraries: Schema.NullOr(NamedLibraries),
  limit: Schema.NullOr(Schema.Number),
  group: Schema.optionalKey(Schema.String),
  filter: Schema.optionalKey(Schema.String),
  fields: Schema.optionalKey(Schema.Array(Schema.String)),
  formulas: Schema.optionalKey(Formulas),
  sort: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        field: Schema.String,
        direction: Schema.Literals(["asc", "desc"]),
      }),
    ),
  ),
  output: Schema.optionalKey(Schema.String),
  // Only a file holds CSV or TSV: the answer itself is always JSON.
  format: Schema.optionalKey(Schema.Literals(DELIMITED_FORMATS)),
  // The id that `zotlit:query-cancel` names the query by.
  id: Schema.optionalKey(Schema.String),
  // The Query Context: the records a filter reads as this.item and this.attachment.
  context: Schema.optionalKey(
    Schema.Struct({
      item: Schema.optionalKey(Schema.String),
      attachment: Schema.optionalKey(Schema.String),
    }),
  ),
});
export type DecodedQuery = typeof DecodedQuery.Type;

/** The arguments of one values listing, as {@link DecodedQuery} crosses. */
export const DecodedValues = Schema.Struct({
  kind: Schema.Literals(["collections", "tags"]),
  match: Schema.optionalKey(Schema.String),
  limit: Schema.NullOr(Schema.Number),
  libraries: Schema.NullOr(NamedLibraries),
});
export type DecodedValues = typeof DecodedValues.Type;
