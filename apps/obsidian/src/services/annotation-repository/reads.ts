// Effect exit handling for the repository's plain read seams.
import type { QueryFunction, QueryKey } from "@tanstack/query-core";

import { Cause, Exit } from "@/lib/effect";
import type { Effect } from "@/lib/effect";
import type { EffectBridge } from "@/lib/effect-bridge";
import type { QueryClients } from "@/services/query-client/service";
import type { ZoteroReads } from "@/services/zotero-reads/service";

export async function refreshDatabase(
  bridge: Pick<EffectBridge, "runPromiseExit" | "closed">,
  db: Pick<ZoteroReads["Service"], "refresh">,
): Promise<void> {
  if (bridge.closed()) return;
  const exit = await bridge.runPromiseExit(db.refresh());
  if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
    throw Cause.squash(exit.cause);
}

export async function readHeld<T>(
  bridge: Pick<EffectBridge, "runPromiseExit" | "closed">,
  queries: Pick<QueryClients["Service"], "read">,
  { key, read }: { key: QueryKey; read: QueryFunction<T> },
): Promise<T | null> {
  if (bridge.closed()) return null;
  const exit = await bridge.runPromiseExit(queries.read(key, read));
  if (Exit.isSuccess(exit)) return exit.value;
  if (exit.cause.reasons.every(Cause.isInterruptReason)) return null;
  throw Cause.squash(exit.cause);
}

export async function runPromise<A, E>(
  bridge: Pick<EffectBridge, "runPromiseExit">,
  effect: Effect.Effect<A, E>,
): Promise<A> {
  const exit = await bridge.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
}
