// Effect exit handling for the repository's plain read seams.
import type { QueryFunction, QueryKey } from "@tanstack/query-core";

import { Effect } from "@/lib/effect";
import { valueOr } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";
import type { QueryClients } from "@/services/query-client/service";
import type { ZoteroReads } from "@/services/zotero-reads/service";

export async function refreshDatabase(
  bridge: Pick<EffectBridge, "runPromiseExit" | "closed">,
  db: Pick<ZoteroReads["Service"], "refresh">,
): Promise<void> {
  if (bridge.closed()) return;
  valueOr(await bridge.runPromiseExit(db.refresh()), undefined);
}

export async function readHeld<T>(
  bridge: Pick<EffectBridge, "runPromiseExit" | "closed">,
  queries: Pick<QueryClients["Service"], "read">,
  { key, read }: { key: QueryKey; read: QueryFunction<T> },
): Promise<T | null> {
  if (bridge.closed()) return null;
  return valueOr(await bridge.runPromiseExit(queries.read(key, read)), null);
}

export function readAll<A, B, C, E>(
  bridge: Pick<EffectBridge, "runPromise">,
  effects: readonly [
    Effect.Effect<A, E, never>,
    Effect.Effect<B, E, never>,
    Effect.Effect<C, E, never>,
  ],
): Promise<readonly [A, B, C]> {
  return bridge.runPromise(Effect.all(effects, { concurrency: "unbounded" }));
}
