// The bridge reads every part of the Annotation Repository core makes: the demanded Local API source, its state, and the query client.
import type { QueryFunction, QueryKey } from "@tanstack/query-core";

import {
  readHeld,
  refreshDatabase,
} from "@/services/annotation-repository/reads";
import type { Held } from "@/services/query-client/service";
import type {
  LocalApiSource,
  LocalApiState,
} from "@/services/zotero-local-api/service";

import type { CoreState } from "./state";

function demandedSource(core: CoreState): LocalApiSource | null {
  return core.bridge.runSync(core.localApi.demandSource);
}

function apiState(core: CoreState): LocalApiState {
  return core.bridge.runSync(core.localApi.state);
}

// After the plugin closes, a read helper answers as the bridge's `closed` says.
function refreshZoteroDatabase(core: CoreState): Promise<void> {
  return refreshDatabase(core.bridge, core.db);
}

function invalidate(core: CoreState, queryKey: QueryKey): void {
  if (!core.bridge.closed())
    core.bridge.runSync(core.queries.invalidate(queryKey));
}

function keysUnder(core: CoreState, prefix: QueryKey): QueryKey[] {
  return core.bridge.closed()
    ? []
    : core.bridge.runSync(core.queries.keysUnder(prefix));
}

function peekQuery<T>(core: CoreState, queryKey: QueryKey): Held<T> | null {
  return core.bridge.closed()
    ? null
    : core.bridge.runSync(core.queries.peek<T>(queryKey));
}

function readHeldQuery<T>(
  core: CoreState,
  queryKey: QueryKey,
  read: QueryFunction<T>,
): Promise<T | null> {
  return readHeld(core.bridge, core.queries, { key: queryKey, read });
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
