/** Literature Note Profiles for views and legacy services. */
import { Cause, Effect, Exit, Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";
import { subscribe } from "@/lib/effect-stream";

import { Profile, ProfileOperationError } from "./service";
import type { ProfileOperations, ProfileState } from "./service";

export type PlainProfile = ProfileOperations & {
  readonly state: ProfileState;
  subscribe(callback: (state: ProfileState) => void): () => void;
  on(event: "changed", callback: () => void): () => void;
};

export function plainProfile(
  runtime: ManagedRuntime.ManagedRuntime<Profile, never>,
): PlainProfile {
  const service = runtime.runSync(Profile);
  const context = runtime.runSync(Effect.context<never>());
  const runSync = Effect.runSyncWith(context);
  const runPromise = Effect.runPromiseExitWith(context);
  const unwrap = <A>(exit: Exit.Exit<A, ProfileOperationError>): A => {
    if (Exit.isSuccess(exit)) return exit.value;
    const error = Cause.squash(exit.cause);
    throw error instanceof ProfileOperationError ? error.cause : error;
  };
  const read = <A>(effect: Effect.Effect<A, ProfileOperationError>) =>
    unwrap(runSync(Effect.exit(effect)));
  const run = async <A>(
    effect: Effect.Effect<A, ProfileOperationError>,
  ): Promise<A> => unwrap(await runPromise(effect));
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
    get diagnostics() {
      return read(service.diagnostics);
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
    duplicate: (...args) => run(service.duplicate(...args)),
    ejectDefault: (...args) => run(service.ejectDefault(...args)),
    materializeDefault: (...args) => run(service.materializeDefault(...args)),
    restoreDefault: (...args) => run(service.restoreDefault(...args)),
    prepareDelete: (...args) => run(service.prepareDelete(...args)),
    delete: (...args) => run(service.delete(...args)),

    prepareCreate: async (options) => {
      const plan = await run(service.prepareCreate(options));
      return { ...plan, create: () => run(plan.create()) };
    },
    prepareShare: async (selector) => {
      const plan = await run(service.prepareShare(selector));
      return { ...plan, render: (options) => read(plan.render(options)) };
    },
    prepareImport: async (source, options) => {
      const plan = await run(service.prepareImport(source, options));
      return {
        ...plan,
        previewSource: (options) => read(plan.previewSource(options)),
        import: (options) => run(plan.import(options)),
      };
    },
    subscribe: (callback) => subscribe(runtime, service.changes, callback),
    on: (_event, callback) => {
      const seen = read(service.state);
      return subscribe(
        runtime,
        Stream.dropWhile(service.changes, (next) => next === seen),
        callback,
      );
    },
  };
}
