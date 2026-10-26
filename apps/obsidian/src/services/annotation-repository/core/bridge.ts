// The bridge reads every part of the Annotation Repository core makes: the demanded Local API source, its state, and the query client.
import type { QueryFunction, QueryKey } from "@tanstack/query-core";
import type { Effect } from "effect";

import type { Held } from "@/services/query-client/service";
import type {
  LocalApiSource,
  LocalApiState,
} from "@/services/zotero-local-api/service";

import type { CoreState } from "./state";

// A plain part of the core runs these through `core.bridge`, the layer's
// `scopedBridge`, until its own slice converts it.

function demandedSource(core: CoreState): Effect.Effect<LocalApiSource | null> {
  return core.localApi.demandSource;
}

function apiState(core: CoreState): Effect.Effect<LocalApiState> {
  return core.localApi.state;
}

/** Fails where the Zotero database cannot refresh; the previous one keeps serving. */
function refreshZoteroDatabase(core: CoreState) {
  return core.db.refresh;
}

/** After the query client closes, the drop does nothing. */
function invalidate(core: CoreState, queryKey: QueryKey): Effect.Effect<void> {
  return core.queries.invalidate(queryKey);
}

/** After the query client closes, it holds no key. */
function keysUnder(
  core: CoreState,
  prefix: QueryKey,
): Effect.Effect<QueryKey[]> {
  return core.queries.keysUnder(prefix);
}

/** After the query client closes, it holds nothing. */
function peekQuery<T>(
  core: CoreState,
  queryKey: QueryKey,
): Effect.Effect<Held<T> | null> {
  return core.queries.peek<T>(queryKey);
}

/** After the query client closes, the read answers null. */
function readHeldQuery<T>(
  core: CoreState,
  queryKey: QueryKey,
  read: QueryFunction<T>,
): Effect.Effect<T | null> {
  return core.queries.read(queryKey, read);
}

export {
  demandedSource,
  apiState,
  refreshZoteroDatabase,
  invalidate,
  keysUnder,
  peekQuery,
  readHeldQuery,
};
