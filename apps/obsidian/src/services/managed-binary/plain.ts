// The shared plain interface of a Managed Binary, run by the plugin runtime.
import { Effect } from "@/lib/effect";
import type { ManagedRuntime, Stream } from "@/lib/effect";

import type { ManagedBinaryApi, ManagedBinaryStatus } from "./service";

export interface PlainManagedBinary<
  Engine extends Disposable | AsyncDisposable = Disposable | AsyncDisposable,
> {
  getStatus(): ManagedBinaryStatus;
  /** The engine while open; `null` after release. */
  getEngine(): Promise<Engine | null>;
  install(): Promise<void>;
  uninstall(): Promise<void>;
  decline(): void;
  readonly changes: Stream.Stream<ManagedBinaryStatus>;
}

export function plainManagedBinary<
  R,
  Engine extends Disposable | AsyncDisposable,
>(
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  binary: ManagedBinaryApi<Engine>,
): PlainManagedBinary<Engine> {
  // Keep the runtime's context for calls that race unload. The service owns
  // its released values; ManagedRuntime clears its context on disposal.
  const context = runtime.runSync(Effect.context<R>());
  const runSync = Effect.runSyncWith(context);
  const runPromise = Effect.runPromiseWith(context);
  let installing: Promise<void> | undefined;
  let installingSource: ManagedBinaryStatus | undefined;
  let installingSnapshot:
    | Extract<ManagedBinaryStatus, { kind: "installing" }>
    | undefined;
  return {
    getStatus: () => {
      const status = runSync(binary.getStatus());
      if (status.kind !== "installing" || !installing) return status;
      if (
        installingSource !== status ||
        installingSnapshot?.done !== installing
      ) {
        installingSource = status;
        installingSnapshot = Object.freeze({ ...status, done: installing });
      }
      return installingSnapshot;
    },
    getEngine: () => runPromise(binary.getEngine()),
    install: () => {
      if (installing) return installing;
      const done = runPromise(binary.install());
      installing = done;
      const clear = () => {
        if (installing === done) installing = undefined;
      };
      void done.then(clear, clear);
      return done;
    },
    uninstall: () => runPromise(binary.uninstall()),
    decline: () => runSync(binary.decline()),
    changes: binary.changes,
  };
}
