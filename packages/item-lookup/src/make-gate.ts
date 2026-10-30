// A test gate an in-memory adapter holds its reads at, with a wait for the first held read.
import { Effect, Latch } from "effect";

export interface Gate {
  readonly closed: boolean;
  /** Hold every later {@link Gate.pass} until {@link Gate.open}. */
  readonly close: Effect.Effect<void>;
  readonly open: Effect.Effect<void>;
  /** Wait until a read is held at the closed gate. */
  readonly held: Effect.Effect<void>;
  /** Wait until the gate opens when it is closed; pass at once when it is open. */
  readonly pass: Effect.Effect<void>;
}

/** @param options.once Hold only the first read after {@link Gate.close}; later reads pass. */
export const makeGate = (options?: {
  readonly once?: boolean;
}): Effect.Effect<Gate> =>
  Effect.gen(function* () {
    let closed = false;
    const gate = yield* Latch.make(true);
    const arrived = yield* Latch.make(false);
    return {
      get closed() {
        return closed;
      },
      close: Effect.suspend(() => {
        closed = true;
        return Effect.andThen(gate.close, arrived.close);
      }).pipe(Effect.asVoid),
      open: Effect.suspend(() => {
        closed = false;
        return gate.open;
      }).pipe(Effect.asVoid),
      held: arrived.await,
      pass: Effect.suspend(() => {
        if (!closed) return Effect.void;
        if (options?.once) closed = false;
        return Effect.andThen(arrived.open, gate.await);
      }),
    } satisfies Gate;
  });
