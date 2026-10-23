// The shared plain interface of a Managed Binary, run by the plugin runtime.
import { Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";
import { subscribe } from "@/lib/effect-stream";

import type { ManagedBinaryApi, ManagedBinaryStatus } from "./service";

export interface PlainManagedBinary<
  Engine extends Disposable | AsyncDisposable = Disposable | AsyncDisposable,
> {
  getStatus(): ManagedBinaryStatus;
  getEngine(): Promise<Engine>;
  install(): Promise<void>;
  uninstall(): Promise<void>;
  decline(): void;
  subscribe(listener: () => void): () => void;
}

export function plainManagedBinary<
  R,
  Engine extends Disposable | AsyncDisposable,
>(
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  binary: ManagedBinaryApi<Engine>,
): PlainManagedBinary<Engine> {
  let installing: Promise<void> | undefined;
  let installingSource: ManagedBinaryStatus | undefined;
  let installingSnapshot:
    | Extract<ManagedBinaryStatus, { kind: "installing" }>
    | undefined;
  return {
    getStatus: () => {
      const status = runtime.runSync(binary.getStatus());
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
    getEngine: () => runtime.runPromise(binary.getEngine()),
    install: () => {
      if (installing) return installing;
      const done = runtime.runPromise(binary.install());
      installing = done;
      const clear = () => {
        if (installing === done) installing = undefined;
      };
      void done.then(clear, clear);
      return done;
    },
    uninstall: () => runtime.runPromise(binary.uninstall()),
    decline: () => runtime.runSync(binary.decline()),
    subscribe: (listener) => {
      const seen = runtime.runSync(binary.getStatus());
      return subscribe(
        runtime,
        Stream.dropWhile(binary.changes, (next) => next === seen),
        listener,
      );
    },
  };
}
