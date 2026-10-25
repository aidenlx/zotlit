// Effect exit handling for the repository's plain read seams.
import type { QueryFunction, QueryKey } from "@tanstack/query-core";
import { Effect } from "effect";

import { valueOr } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";
import { settleAtEdge } from "@/lib/signal-edge";
import type { QueryClients } from "@/services/query-client/service";
import type {
  LocalApiAnnotation,
  LocalApiResult,
  ZoteroLocalApi,
} from "@/services/zotero-local-api/service";
import type { ZoteroReads } from "@/services/zotero-reads/service";

export async function refreshDatabase(
  bridge: Pick<EffectBridge, "runPromiseExit" | "closed">,
  db: Pick<ZoteroReads["Service"], "refresh">,
): Promise<void> {
  if (bridge.closed()) return;
  valueOr(await bridge.runPromiseExit(db.refresh), undefined);
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

/**
 * The Zotero Local API list of one Attachment, interrupted when `signal`
 * aborts, which rejects with `signal.reason`. A read the runtime's close
 * interrupted answers `unknown-outcome`. Neither says anything about the
 * session: it stays standing.
 */
export async function listLocalApi(
  {
    bridge,
    api,
  }: {
    bridge: Pick<EffectBridge, "runPromiseExit">;
    api: Pick<ZoteroLocalApi["Service"], "listAnnotations">;
  },
  attachmentKey: string,
  signal: AbortSignal,
): Promise<LocalApiResult<readonly LocalApiAnnotation[]>> {
  return settleAtEdge(
    await bridge.runPromiseExit(api.listAnnotations(attachmentKey), { signal }),
    signal,
    () => ({ failure: { kind: "unknown-outcome" } }),
  );
}
