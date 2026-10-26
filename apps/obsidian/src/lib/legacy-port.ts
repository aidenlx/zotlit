// The typed failure of a legacy Promise port that Effect code calls.
import { Effect, Schema } from "effect";

import { formatErrorMessage } from "./toast";

/** A legacy Promise port rejected. The message is the rejection's own. */
export class LegacyPortError extends Schema.TaggedError<
  LegacyPortError,
  { readonly brand: unique symbol }
>()("LegacyPortError", {
  /** The port call that rejected, such as "write-update". */
  step: Schema.String,
  /** What the port rejected with. */
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return formatErrorMessage(this.cause);
  }
}

/** A legacy port's Promise, its rejection a {@link LegacyPortError}. */
export const portCall = <const S extends string, A>(
  step: S,
  call: (signal: AbortSignal) => Promise<A>,
) =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => new LegacyPortError({ step, cause }),
  });
