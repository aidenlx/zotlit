// The query the ZoteroReads worker receives for CLI parameters: decoded by
// the renderer, then passed through the codec of the worker seam.
import type { CliData } from "obsidian";

import { Effect, Schema } from "effect";

import { decodeQuery } from "@/services/item-query/decode";
import { DecodedQuery } from "@/services/item-query/query-codec";

/** Throws the rejection of a malformed test query: fixture data, not a case. */
export function workerQuery(params: CliData = {}): DecodedQuery {
  const query = Effect.runSync(decodeQuery(params));
  return Schema.decodeSync(DecodedQuery)(
    Schema.encodeSync(DecodedQuery)(query),
  );
}
