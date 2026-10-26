// The Use Ledger for callers outside Effect: legacy services and views. It
// hands each Use's instant over as the Temporal.Instant plain code reads.
import { Effect, Stream } from "effect";
import type { ManagedRuntime } from "effect";
import type { TFile } from "obsidian";

import { effectBridge } from "@/lib/effect-bridge";
import { fromInstant, toInstant } from "@/lib/effect-clock";

import { UseLedger } from "./service";
import type { Ledger, Use, UseKind } from "./service";

/** A {@link Use} for plain code. */
export interface PlainUse {
  readonly instant: Temporal.Instant;
  readonly kind: UseKind;
}

/** The newest {@link PlainUse} of each Item, keyed by Item key. */
export type PlainLedger = Readonly<Record<string, PlainUse>>;

/** {@link UseLedger} as plain values and Promises. */
export interface PlainUseLedger {
  readonly changes: Stream.Stream<PlainLedger>;
  readonly current: PlainLedger;
  get(itemKey: string): PlainUse | undefined;
  /** A snapshot for the query worker and the empty Item search. */
  readonly uses: Readonly<Record<string, number>>;
  /** Keeps the newest Use and returns this action for live read write-back. */
  record(itemKey: string, kind: UseKind, instant?: Temporal.Instant): PlainUse;
  /** Keep a Companion update's own navigation outside the Use timeline. */
  withoutNoteUse<T>(file: TFile, open: () => Promise<T>): Promise<T>;
}

// One plain value per Use and per Ledger, so a caller sees the same object
// until the ledger changes, as it does in Effect.
const plainUses = new WeakMap<Use, PlainUse>();
const plainLedgers = new WeakMap<Ledger, PlainLedger>();

function plainUse(use: Use): PlainUse {
  let plain = plainUses.get(use);
  if (!plain) {
    plain = Object.freeze({ instant: toInstant(use.instant), kind: use.kind });
    plainUses.set(use, plain);
  }
  return plain;
}

function plainLedger(ledger: Ledger): PlainLedger {
  let plain = plainLedgers.get(ledger);
  if (!plain) {
    plain = Object.freeze(
      Object.fromEntries(
        Object.entries(ledger).map(([key, use]) => [key, plainUse(use)]),
      ),
    );
    plainLedgers.set(ledger, plain);
  }
  return plain;
}

/** The ledger of `runtime`, run by it for each call. */
export function plainUseLedger(
  runtime: ManagedRuntime.ManagedRuntime<UseLedger, never>,
): PlainUseLedger {
  const ledger = runtime.runSync(UseLedger.use(Effect.succeed));
  const { runSync, runPromise } = effectBridge(runtime);
  return {
    get current() {
      return plainLedger(runSync(ledger.current));
    },
    get: (itemKey) => {
      const use = runSync(ledger.get(itemKey));
      return use && plainUse(use);
    },
    get uses() {
      return runSync(ledger.uses);
    },
    record: (itemKey, kind, instant) =>
      plainUse(
        runSync(ledger.record(itemKey, kind, instant && fromInstant(instant))),
      ),
    withoutNoteUse: (file, open) =>
      runPromise(
        ledger.withoutNoteUse(
          file,
          Effect.promise(() => open()),
        ),
      ),
    changes: Stream.map(ledger.changes, (uses) => plainLedger(uses)),
  };
}
