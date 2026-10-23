// One parse contract for the worker and its in-process twin.
import { Rpc, RpcGroup } from "effect/rpc";

import { Predicate, Schema } from "@/lib/effect";
import type { NoteScanRecord } from "@/services/citation-index/scan-note";

export class ParseError extends Schema.TaggedError<ParseError>()("ParseError", {
  message: Schema.String,
}) {}

// The scanner owns the record shape. JSON keeps large records off the
// structured-clone object path, as in the original parse transport.
const Reply = Schema.fromJsonString(
  Schema.Struct({
    path: Schema.String,
    generation: Schema.Number,
    record: Schema.declare((value: unknown): value is NoteScanRecord =>
      Predicate.isObject(value),
    ),
  }),
);

export const CitationParseRpc = RpcGroup.make(
  Rpc.make("Parse", {
    payload: {
      path: Schema.String,
      generation: Schema.Number,
      text: Schema.String,
    },
    success: Reply,
    error: ParseError,
  }),
);
