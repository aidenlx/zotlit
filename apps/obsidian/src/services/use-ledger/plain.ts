// The Use Ledger for callers outside Effect: legacy services and views.
import { Effect } from "effect";
import type { ManagedRuntime, Stream } from "effect";
import type { TFile } from "obsidian";

import { UseLedger } from "./service";
import type { Ledger, Use, UseKind } from "./service";

/** {@link UseLedger} as plain values and Promises. */
export interface PlainUseLedger {
  readonly changes: Stream.Stream<Ledger>;
  readonly current: Ledger;
  get(itemKey: string): Use | undefined;
  /** A snapshot for the query worker and the empty Item search. */
  readonly uses: Readonly<Record<string, number>>;
  /** Keeps the newest Use and returns this action for live read write-back. */
  record(itemKey: string, kind: UseKind, instant?: Temporal.Instant): Use;
  /** Keep a Companion update's own navigation outside the Use timeline. */
  withoutNoteUse<T>(file: TFile, open: () => Promise<T>): Promise<T>;
}

/** The ledger of `runtime`, run by it for each call. */
export function plainUseLedger(
  runtime: ManagedRuntime.ManagedRuntime<UseLedger, never>,
): PlainUseLedger {
  const ledger = runtime.runSync(UseLedger.use(Effect.succeed));
  const context = runtime.runSync(Effect.context<never>());
  const runSync = Effect.runSyncWith(context);
  const runPromise = Effect.runPromiseWith(context);
  return {
    get current() {
      return runSync(ledger.current);
    },
    get: (itemKey) => runSync(ledger.get(itemKey)),
    get uses() {
      return runSync(ledger.uses);
    },
    record: (itemKey, kind, instant) =>
      runSync(ledger.record(itemKey, kind, instant)),
    withoutNoteUse: (file, open) =>
      runPromise(
        ledger.withoutNoteUse(
          file,
          Effect.promise(() => open()),
        ),
      ),
    changes: ledger.changes,
  };
}
