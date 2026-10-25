// One parse contract for the worker and its in-process twin.
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

export class ParseError extends Schema.TaggedError<
  ParseError,
  { readonly brand: unique symbol }
>()("ParseError", {
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
