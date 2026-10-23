// The Use Ledger for callers outside Effect: legacy services and views.
import type { TFile } from "obsidian";

import { Effect, Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";
import { subscribe } from "@/lib/effect-stream";

import { UseLedger } from "./service";
import type { Ledger, Use, UseKind } from "./service";

/** {@link UseLedger} as plain values and Promises. */
export interface PlainUseLedger {
  readonly current: Ledger;
  get(itemKey: string): Use | undefined;
  /** A snapshot for the query worker and the empty Item search. */
  readonly uses: Readonly<Record<string, number>>;
  /** Keeps the newest Use and returns this action for live read write-back. */
  record(itemKey: string, kind: UseKind, instant?: Temporal.Instant): Use;
  /** Keep a Companion update's own navigation outside the Use timeline. */
  withoutNoteUse<T>(file: TFile, open: () => Promise<T>): Promise<T>;
  /**
   * Call `callback` with each ledger a Use recorded after this call replaces
   * the current one with, until the returned function stops it.
   */
  subscribe(callback: (ledger: Ledger) => void): () => void;
}

/** The ledger of `runtime`, run by it for each call. */
export function plainUseLedger(
  runtime: ManagedRuntime.ManagedRuntime<UseLedger, never>,
): PlainUseLedger {
  const ledger = runtime.runSync(UseLedger.use(Effect.succeed));
  return {
    get current() {
      return runtime.runSync(ledger.current);
    },
    get: (itemKey) => runtime.runSync(ledger.get(itemKey)),
    get uses() {
      return runtime.runSync(ledger.uses);
    },
    record: (itemKey, kind, instant) =>
      runtime.runSync(ledger.record(itemKey, kind, instant)),
    withoutNoteUse: (file, open) =>
      runtime.runPromise(ledger.withoutNoteUse(file, Effect.promise(open))),
    subscribe: (callback) => {
      if (runtime.scope.state._tag === "Closed") return () => {};
      const seen = runtime.runSync(ledger.current);
      return subscribe(
        runtime,
        Stream.dropWhile(ledger.changes, (next) => next === seen),
        callback,
      );
    },
  };
}
