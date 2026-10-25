// Consent-gated download, hash verification, and device-wide cache of one pinned Managed Binary.

import {
  Cause,
  Effect,
  Exit,
  Fiber,
  Layer,
  Predicate,
  PubSub,
  Schema,
  Scope,
  SubscriptionRef,
} from "effect";
import type { Context, Stream } from "effect";

import { withLogCategory } from "@/lib/effect-log";
import { startupBarrier } from "@/lib/effect-startup";

import type { BinaryPin } from "./pin";
import {
  ManagedBinaryError,
  ManagedBinaryPlatform,
  managedBinaryError,
} from "./platform";
export { ManagedBinaryPlatform, layerManagedBinaryPlatform } from "./platform";
export type { ManagedBinaryHostPorts, ManagedBinaryPorts } from "./platform";

export type { BinaryPin } from "./pin";
export type { BinaryStore } from "./store";

/** Suffix of a cached binary; a download still running writes `.part` instead. */
const BINARY_SUFFIX = ".wasm";

/**
 * One Managed Binary: what a release pins, where the device caches it, and what
 * it starts once verified. Two declarations with distinct `id`s share no cache
 * entry and no consent record.
 */
export interface ManagedBinary<Engine extends AsyncDisposable | Disposable> {
  /**
   * Names the binary on the device: its cache directory `zotlit/<id>` and its
   * vault-scoped consent record `zotlit-<id>-declined`.
   */
  readonly id: string;
  /** The binary's name in logs and error messages, e.g. `Pandoc engine`. */
  readonly label: string;
  readonly logCategory: readonly [string, ...string[]];
  readonly pin: BinaryPin;
  /**
   * The binary inside the downloaded asset.
   * @default the asset itself, for an asset that is the bare binary
   */
  readonly extract?: (
    asset: Uint8Array<ArrayBuffer>,
  ) => Uint8Array<ArrayBuffer>;
  /** Starts the engine over the verified binary, streamed rather than materialized. */
  readonly createEngine: (binary: Blob) => Promise<Engine>;
  /**
   * Start the engine once after each install, then release it, so a binary
   * that does not start reports `init-failed` before its first use.
   * @default false
   */
  readonly startOnInstall?: boolean;
}

/**
 * One file of the device-wide store: `<directory>/<name>`, where `directory` is
 * the binary's `id` and `name` its cached name, `<sha256>.wasm`. The shape
 * matches `SegmenterBinary`, so a location passes straight through to the
 * ZoteroReads worker.
 *
 * @see SegmenterBinary in `@zotlit/item-lookup`
 */
export interface BinaryLocation {
  readonly directory: string;
  readonly name: string;
}

/** Why a binary is unusable, in the terms the fallback surface guides out of. */
export type ManagedBinaryFailure =
  | { code: "download-failed"; url: string; detail: string }
  | { code: "hash-mismatch"; expected: string; actual: string }
  | { code: "init-failed"; detail: string };

/**
 * Where a binary stands. Arms are mutually exclusive, so one shared fallback
 * surface renders one of them rather than deriving its own combination of
 * flags.
 */
export type ManagedBinaryStatus =
  /** No binary is cached, and the install offer still stands. */
  | { kind: "absent" }
  /** No binary is cached, and this vault dismissed the offer. */
  | { kind: "declined" }
  /**
   * An install runs. `binary` is the location that stays readable meanwhile:
   * the one installed before a reinstall, or `null`.
   */
  | { kind: "installing"; done: Promise<void>; binary: BinaryLocation | null }
  /** A verified binary is cached at `binary`. */
  | { kind: "installed"; version: string; binary: BinaryLocation }
  | { kind: "failed"; failure: ManagedBinaryFailure };

/** The name a verified binary is cached under: its pinned hash. */
function cachedBinaryName(pin: BinaryPin): string {
  return `${pin.sha256}${BINARY_SUFFIX}`;
}

/** Effect-native operations; the layer owns startup, installs, and engines. */
export interface ManagedBinaryApi<Engine extends Disposable | AsyncDisposable> {
  readonly getStatus: Effect.Effect<ManagedBinaryStatus>;
  readonly changes: Stream.Stream<ManagedBinaryStatus>;
  readonly getEngine: Effect.Effect<Engine | null, ManagedBinaryError>;
  readonly install: Effect.Effect<void, ManagedBinaryError | HashMismatchError>;
  readonly uninstall: Effect.Effect<void, ManagedBinaryError>;
  readonly decline: Effect.Effect<void>;
}

/** One descriptor becomes one independently scoped service under its own tag. */
export function layerManagedBinary<
  Id,
  Engine extends Disposable | AsyncDisposable,
>(
  tag: Context.Service<Id, ManagedBinaryApi<Engine>>,
  binary: ManagedBinary<Engine>,
): Layer.Layer<Id, never, ManagedBinaryPlatform> {
  return Layer.effect(tag, makeManagedBinary(binary));
}

const attempt = <A>(
  run: () => Promise<A>,
): Effect.Effect<A, ManagedBinaryError> =>
  Effect.tryPromise({ try: run, catch: managedBinaryError });

/** The running install, failing as it fails, so a second caller sees the same error. */
const joinInstall = (
  done: Promise<void>,
): Effect.Effect<void, ManagedBinaryError | HashMismatchError> =>
  Effect.tryPromise({
    try: () => done,
    catch: (error) =>
      error instanceof HashMismatchError ? error : managedBinaryError(error),
  });

const makeManagedBinary = Effect.fn("ManagedBinary.make")(function* <
  Engine extends Disposable | AsyncDisposable,
>(binary: ManagedBinary<Engine>) {
  const platform = yield* ManagedBinaryPlatform;
  const { consent } = platform;
  const scope = yield* Effect.scope;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const store = yield* platform.openStore(binary.id);
  const name = cachedBinaryName(binary.pin);
  const location = { directory: binary.id, name };
  const declinedKey = `zotlit-${binary.id}-declined`;
  const status = yield* SubscriptionRef.make<ManagedBinaryStatus>(
    Object.freeze(
      (yield* consent.loadLocalStorage(declinedKey))
        ? { kind: "declined" }
        : { kind: "absent" },
    ),
  );
  let closed = false;
  const setStatus = (next: ManagedBinaryStatus) =>
    SubscriptionRef.set(status, Object.freeze(next));
  const log = (
    message: string,
    fields: Record<string, unknown>,
    level: "info" | "warn" | "error" = "info",
  ) =>
    (level === "error"
      ? Effect.logError(message)
      : level === "warn"
        ? Effect.logWarning(message)
        : Effect.logInfo(message)
    ).pipe(
      Effect.annotateLogs({ binary: binary.id, ...fields }),
      withLogCategory(...binary.logCategory),
    );
  const isCached = Effect.fn("ManagedBinary.isCached")(function* () {
    return yield* store.list.pipe(
      Effect.map((names) => names.includes(name)),
      Effect.catch((error) =>
        log("Cannot read the binary cache", { error }, "warn").pipe(
          Effect.as(false),
        ),
      ),
    );
  });
  const discoverCache = Effect.gen(function* () {
    if (yield* isCached()) {
      const current = yield* SubscriptionRef.get(status);
      if (current.kind === "absent" || current.kind === "declined")
        yield* setStatus({
          kind: "installed",
          version: binary.pin.version,
          binary: location,
        });
    }
  }).pipe(
    Effect.catchCause((cause) =>
      log(
        "Cannot read the binary cache",
        { error: Cause.squash(cause) },
        "warn",
      ),
    ),
  );

  yield* startupBarrier(
    discoverCache,
    log(
      "Binary cache discovery is still running; using initial status",
      {},
      "warn",
    ),
  );

  const failInit = Effect.fn("ManagedBinary.failInit")(function* (
    error: ManagedBinaryError,
  ) {
    const failure: ManagedBinaryFailure = {
      code: "init-failed",
      detail: describe(error),
    };
    yield* log("The binary did not start", { failure, error }, "error");
    yield* setStatus({ kind: "failed", failure });
  });
  const startEngine = Effect.fn("ManagedBinary.startEngine")(function* () {
    const blob = yield* store.read(name).pipe(
      Effect.filterOrFail(
        Predicate.isNotUndefined,
        () =>
          new ManagedBinaryError({
            message: `The cached ${binary.label} binary is gone`,
          }),
      ),
      Effect.tapError((error) => failInit(error)),
    );
    return yield* attempt(() => binary.createEngine(blob)).pipe(
      Effect.catch(
        Effect.fn("ManagedBinary.failedStart")(function* (error) {
          const actual = yield* attempt(async () =>
            sha256Hex(await blob.arrayBuffer()),
          );
          if (actual !== binary.pin.sha256) {
            yield* log(
              "The cached binary is corrupt",
              { name, actual, error },
              "warn",
            );
            yield* store.remove(name).pipe(Effect.ignore);
            yield* setStatus({ kind: "absent" });
          } else yield* failInit(error);
          return yield* error;
        }),
      ),
    );
  });
  const acquireEngine = Effect.acquireRelease(startEngine(), (engine) =>
    attempt(async () => {
      if (Symbol.asyncDispose in engine) await engine[Symbol.asyncDispose]();
      else engine[Symbol.dispose]();
    }).pipe(
      Effect.catchCause((cause) =>
        log(
          "Could not release the binary engine",
          { error: Cause.squash(cause) },
          "error",
        ),
      ),
    ),
  );
  let engine:
    | {
        fiber: Fiber.Fiber<Engine, ManagedBinaryError>;
        scope: Scope.Closeable;
      }
    | undefined;
  const dropEngine = Effect.fn("ManagedBinary.dropEngine")(function* () {
    const pending = engine;
    engine = undefined;
    if (pending) {
      yield* Fiber.await(pending.fiber);
      yield* Scope.close(pending.scope, Exit.void);
    }
  });
  yield* Effect.addFinalizer(() => dropEngine());
  const getEngine = Effect.gen(function* () {
    if (closed) return null;
    if (!engine) {
      if ((yield* SubscriptionRef.get(status)).kind !== "installed")
        return yield* new ManagedBinaryError({
          message: `The ${binary.label} is not installed`,
        });
      const engineScope = yield* Scope.make();
      const fiber = yield* Effect.forkIn(
        acquireEngine.pipe(Effect.provideService(Scope.Scope, engineScope)),
        scope,
        { uninterruptible: true },
      );
      engine = { fiber, scope: engineScope };
    }
    const pending = engine;
    return yield* Fiber.join(pending.fiber).pipe(
      Effect.tapError(() =>
        Effect.gen(function* () {
          if (engine === pending) engine = undefined;
          yield* Scope.close(pending.scope, Exit.void);
        }),
      ),
    );
  }).pipe(Effect.withSpan("ManagedBinary.getEngine"));
  const fetchBinary = Effect.fn("ManagedBinary.fetchBinary")(function* () {
    const { url, sha256 } = binary.pin;
    yield* log("Downloading the binary", { url });
    const asset = yield* platform.download(url);
    const bytes = yield* Effect.try({
      try: () => (binary.extract ? binary.extract(asset) : asset),
      catch: (error) =>
        new ManagedBinaryError({ message: describe(error), cause: error }),
    });
    const temp = `${sha256}.${crypto.randomUUID()}.part`;
    // The release also covers a failed write, so a partial file cannot outlive this install.
    yield* Effect.acquireUseRelease(
      Effect.succeed(temp),
      () =>
        Effect.gen(function* () {
          yield* store.write(temp, bytes);
          const actual = yield* attempt(() => sha256Hex(bytes));
          if (actual !== sha256)
            return yield* new HashMismatchError({ expected: sha256, actual });
          yield* store.rename(temp, name);
        }),
      () => store.remove(temp).pipe(Effect.ignore),
    );
  });
  const prune = Effect.fn("ManagedBinary.prune")(
    function* () {
      for (const entry of yield* store.list) {
        if (entry !== name && entry.endsWith(BINARY_SUFFIX))
          yield* store.remove(entry);
      }
    },
    Effect.catch((error) =>
      log("Cannot drop the superseded binaries", { error }, "warn"),
    ),
  );
  const runInstall = Effect.fn("ManagedBinary.runInstall")(function* () {
    yield* Effect.gen(function* () {
      if (!(yield* isCached())) yield* fetchBinary();
      yield* prune();
    }).pipe(
      Effect.tapError(
        Effect.fn("ManagedBinary.failedInstall")(function* (error) {
          const failure = toFailure(error, binary.pin.url);
          yield* log("The binary install failed", { failure, error }, "error");
          yield* setStatus({ kind: "failed", failure });
        }),
      ),
    );
    if (binary.startOnInstall) yield* Effect.scoped(acquireEngine);
    yield* log("Installed the binary", {
      version: binary.pin.version,
      sha256: binary.pin.sha256,
    });
    yield* setStatus({
      kind: "installed",
      version: binary.pin.version,
      binary: location,
    });
  });
  const install = Effect.gen(function* () {
    if (closed) return;
    const current = yield* SubscriptionRef.get(status);
    if (current.kind === "installing") return yield* joinInstall(current.done);
    yield* consent.saveLocalStorage(declinedKey, null);
    // The inherited Promise belongs to the public status contract. Its work is
    // a scoped fiber, and this runner retains the layer's services and Clock.
    const fiber = yield* Effect.forkIn(runInstall(), scope, {
      uninterruptible: true,
    });
    const done = runPromise(Fiber.join(fiber));
    void done.catch(() => undefined);
    yield* setStatus({
      kind: "installing",
      done,
      binary: current.kind === "installed" ? current.binary : null,
    });
    yield* Fiber.join(fiber);
  }).pipe(Effect.withSpan("ManagedBinary.install"));
  const uninstall = Effect.gen(function* () {
    if (closed) return;
    const fiber = yield* Effect.forkIn(
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(status);
        if (current.kind === "installing")
          yield* joinInstall(current.done).pipe(Effect.ignore);
        yield* dropEngine();
        yield* store.clear;
        yield* consent.saveLocalStorage(declinedKey, null);
        yield* log("Removed the binary cache", { pin: binary.pin });
        yield* setStatus({ kind: "absent" });
      }),
      scope,
      { uninterruptible: true },
    );
    yield* Fiber.join(fiber);
  }).pipe(Effect.withSpan("ManagedBinary.uninstall"));
  const decline = Effect.gen(function* () {
    if (closed) return;
    yield* consent.saveLocalStorage(declinedKey, true);
    if ((yield* SubscriptionRef.get(status)).kind === "absent")
      yield* setStatus({ kind: "declined" });
  }).pipe(Effect.withSpan("ManagedBinary.decline"));
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      closed = true;
      yield* PubSub.shutdown(status.pubsub);
    }),
  );
  return {
    getStatus: SubscriptionRef.get(status),
    changes: SubscriptionRef.changes(status),
    getEngine,
    install,
    uninstall,
    decline,
  } satisfies ManagedBinaryApi<Engine>;
});

/** The downloaded binary does not hash to its pin. */
export class HashMismatchError extends Schema.TaggedError<
  HashMismatchError,
  { readonly brand: unique symbol }
>()("HashMismatchError", { expected: Schema.String, actual: Schema.String }) {
  override get message(): string {
    return `Expected the binary to hash to ${this.expected}, got ${this.actual}`;
  }
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toFailure(error: unknown, url: string): ManagedBinaryFailure {
  return error instanceof HashMismatchError
    ? { code: "hash-mismatch", expected: error.expected, actual: error.actual }
    : { code: "download-failed", url, detail: describe(error) };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
