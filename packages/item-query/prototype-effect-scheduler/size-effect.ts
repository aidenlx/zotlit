// PROTOTYPE — bundle-size probe for #1313: the Effect engine plus what the Obsidian adapter calls.
import { Cause, Effect, Exit } from "effect";

import { ItemQueryDatabase, queryItems } from "./executor-effect.ts";
import { BudgetScheduler, messageChannelPause, Recorder } from "./scheduler.ts";

export async function adapter(
  db: any,
  query: any,
  opts: any,
  signal: AbortSignal,
) {
  if (signal.aborted) return { cancelled: true };
  const mc = messageChannelPause();
  const scheduler = new BudgetScheduler(
    new Recorder(() => performance.now()),
    8,
    mc.pause,
  );
  const trace: any = { statements: 0, candidateCount: 0, hydratedCount: 0 };
  const exit = await Effect.runPromiseExit(
    queryItems(query, opts, () => performance.now(), trace).pipe(
      Effect.provideService(ItemQueryDatabase, { db, release() {} }),
    ),
    { signal, scheduler },
  );
  mc.close();
  if (Exit.isSuccess(exit)) return exit.value;
  if (Exit.hasInterrupts(exit)) return { cancelled: true };
  return { error: Cause.squash(exit.cause) };
}
