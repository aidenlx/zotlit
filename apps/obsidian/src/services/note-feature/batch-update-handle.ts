// The library-wide note update for callers outside Effect: the update-all command and the Workbench's saved notice.
import { Effect } from "effect";
import type { Context } from "effect";

import type { EffectBridge } from "@/lib/effect-bridge";

import { runBatchUpdateAll } from "./update-batch";
import type {
  BatchUpdate,
  BatchUpdatePorts,
  BatchUpdateServices,
} from "./update-batch";

/**
 * The library-wide update over `context`, run through `bridge`. It resolves
 * with its outcome and rejects with what failed, as a read or a write does.
 * The batch modal's callbacks run through `bridge` too.
 */
export function bindBatchUpdate(
  bridge: Pick<EffectBridge, "runPromise" | "runPromiseExit">,
  context: Context.Context<BatchUpdateServices>,
  ports: Omit<BatchUpdatePorts, "bridge">,
): BatchUpdate {
  const updatePorts: BatchUpdatePorts = { ...ports, bridge };
  return {
    runBatchUpdateAll: (target) =>
      bridge.runPromise(
        Effect.provideContext(runBatchUpdateAll(updatePorts, target), context),
      ),
  };
}
