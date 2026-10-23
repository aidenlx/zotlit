import { Effect, Exit } from "@/lib/effect";

/** Preserve the codec's value type when narrowing Effect's eager Exit result. */
export function isRpcCodecSuccess<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): effect is Exit.Success<A, E> {
  return Exit.isExit(effect) && Exit.isSuccess(effect);
}

/** Time encoder invocation as well as completion; production omits this wrapper. */
export function observeRpcEncoding<A, B, E, R>(
  encode: (value: A) => Effect.Effect<B, E, R>,
  measure: () => () => void,
): (value: A) => Effect.Effect<B, E, R> {
  return (value) => {
    const end = measure();
    let encoded: Effect.Effect<B, E, R>;
    try {
      encoded = encode(value);
    } catch (error) {
      end();
      throw error;
    }
    if (Exit.isExit(encoded)) {
      end();
      return encoded;
    }
    return encoded.pipe(Effect.ensuring(Effect.sync(end)));
  };
}
