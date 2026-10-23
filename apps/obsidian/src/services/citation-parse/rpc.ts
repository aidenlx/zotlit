// One parse contract for the worker and its in-process twin.
import { Rpc, RpcGroup } from "effect/rpc";

import { Schema } from "@/lib/effect";

export class ParseError extends Schema.TaggedError<ParseError>()("ParseError", {
  message: Schema.String,
}) {}

// The scanner owns the JSON record. RPC transports this text unchanged;
// callers decode it once at the plain parse boundary.
export const CitationParseRpc = RpcGroup.make(
  Rpc.make("Parse", {
    payload: {
      path: Schema.String,
      generation: Schema.Number,
      text: Schema.String,
    },
    success: Schema.String,
    error: ParseError,
  }),
);
