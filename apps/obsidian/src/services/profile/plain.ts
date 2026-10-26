/** Literature Note Profiles for views and legacy services. */
import { Cause, Effect, Exit, Stream } from "effect";
import type { ManagedRuntime } from "effect";

import { effectBridge } from "@/lib/effect-bridge";

import { Profile, ProfileOperationError } from "./service";
import type { ProfileOperations, ProfileState } from "./service";

/** The Profile members views, legacy services and e2e still read. */
export type PlainProfile = Omit<
  ProfileOperations,
  | "duplicate"
  | "ejectDefault"
  | "prepareDelete"
  | "prepareCreate"
  | "prepareShare"
  | "prepareImport"
  | "diagnostics"
> & {
  readonly changes: Stream.Stream<ProfileState>;
  readonly changed: Stream.Stream<void>;
  readonly state: ProfileState;
};

export function plainProfile(
  runtime: Pick<
    ManagedRuntime.ManagedRuntime<Profile, never>,
    "runSync" | "runFork" | "scope"
  >,
): PlainProfile {
  const service = runtime.runSync(Profile);
  // Unload stops a pending call, which then rejects with an `AbortError`.
  const bridge = effectBridge(runtime);
  const plainError = (error: unknown) =>
    error instanceof ProfileOperationError ? error.cause : error;
  const read = <A>(effect: Effect.Effect<A, ProfileOperationError>): A => {
    const exit = bridge.runSync(Effect.exit(effect));
    if (Exit.isSuccess(exit)) return exit.value;
    throw plainError(Cause.squash(exit.cause));
  };
  const run = <A>(
    effect: Effect.Effect<A, ProfileOperationError>,
  ): Promise<A> =>
    bridge.runPromise(effect).catch((error: unknown) => {
      throw plainError(error);
    });
  return {
    get state() {
      return read(service.state);
    },
    get loaded() {
      return read(service.loaded);
    },
    get profiles() {
      return read(service.profiles);
    },
    get defaultDocumentPath() {
      return read(service.defaultDocumentPath);
    },
    resolveProfile: (...args) => read(service.resolveProfile(...args)),
    profileOf: (...args) => read(service.profileOf(...args)),
    getBuiltInSource: (...args) => read(service.getBuiltInSource(...args)),
    create: (...args) => run(service.create(...args)),
    getSource: (...args) => run(service.getSource(...args)),
    saveSource: (...args) => run(service.saveSource(...args)),
    setMatch: (...args) => run(service.setMatch(...args)),
    materializeDefault: (...args) => run(service.materializeDefault(...args)),
    restoreDefault: (...args) => run(service.restoreDefault(...args)),
    delete: (...args) => run(service.delete(...args)),
    changes: service.changes,
    changed: service.changes.pipe(
      Stream.drop(1),
      Stream.map(() => undefined),
    ),
  };
}
