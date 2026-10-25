// A Zotero read snapshot lease owned by code outside Effect.
import { Cause, Exit, Scope } from "effect";

import type { EffectBridge } from "@/lib/effect-bridge";
import { openScope } from "@/lib/effect-scope";

import { DbUnavailable } from "./rpc";
import type { ZoteroReadLease, ZoteroReads } from "./service";

const leakedLeases = new FinalizationRegistry<() => Promise<void>>(
  (close) => void close(),
);

export async function acquireReadLease(
  reads: Pick<ZoteroReads["Service"], "snapshot">,
  bridge: Pick<EffectBridge, "runPromiseExit" | "closed">,
): Promise<ZoteroReadLease> {
  if (bridge.closed())
    throw new DbUnavailable({ message: "ZoteroReads is closed" });
  const { scope, close } = openScope();
  try {
    const exit = await bridge.runPromiseExit(
      Scope.provide(reads.snapshot, scope),
    );
    if (Exit.isFailure(exit)) {
      if (bridge.closed())
        throw new DbUnavailable({ message: "ZoteroReads is closed" });
      throw Cause.squash(exit.cause);
    }
    const snapshot = exit.value;
    const token = {};
    leakedLeases.register(snapshot, close, token);
    return {
      reads: snapshot,
      [Symbol.asyncDispose]: () => {
        leakedLeases.unregister(token);
        return close();
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
