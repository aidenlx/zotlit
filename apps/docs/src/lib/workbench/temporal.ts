// Temporal for the runtimes that do not carry it yet. The polyfill is a lazy
// import so a browser that ships Temporal never downloads it.
import { Effect } from "effect";

/** Installs the `Temporal` polyfill where the runtime has no `Temporal`. */
export const loadTemporal = Effect.suspend(() =>
  globalThis.Temporal !== undefined
    ? Effect.void
    : Effect.tryPromise(() => import("@js-temporal/polyfill")).pipe(
        Effect.map(({ Temporal }) => {
          globalThis.Temporal =
            Temporal as unknown as typeof globalThis.Temporal;
        }),
      ),
);
