// An Effect Scope for code that lives outside Effect: a service's load, a lease.
import { Effect, Exit, Scope } from "@/lib/effect";

/** A scope opened now, with the promise that closes it. Closing never fails. */
export function openScope(): {
  scope: Scope.Closeable;
  close: () => Promise<void>;
} {
  const scope = Effect.runSync(Scope.make());
  return {
    scope,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
}
