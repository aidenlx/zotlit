/**
 * Startup + disposal lifecycle base class for plugin services.
 *
 * Subclasses:
 * - Declare and assign `ready` (typically `this.ready = this.#load()` in the constructor).
 *   Services that acquire resources can return their loaded state from `ready`
 *   by extending `Service<State>`.
 * - Acquire resources inside `#load()` under a local `await using stack = new AsyncDisposableStack()`,
 *   then call `this.commit(stack.move())` on the success path.
 * - Do NOT override `[Symbol.asyncDispose]`; the base owns the
 *   "wait for `ready` before disposing committed resources" invariant.
 *
 * `ready` represents startup only. It must settle after the service has
 * registered/acquired its resources and must not wait for long-lived UI signals
 * such as `workspace.onLayoutReady`. Disposal awaits `ready`, so a non-settling
 * `ready` will hang cleanup.
 */
export abstract class Service<TReady = void> implements AsyncDisposable {
  #disposables?: AsyncDisposableStack;
  #disposed = false;

  /** Resolves when startup finished, or rejects with the startup failure. */
  abstract ready: Promise<TReady>;

  /**
   * Take ownership of the resources acquired during startup. Call exactly once
   * on the success path of `#load()`. Throws on double-commit or
   * commit-after-dispose, disposing the passed stack so its resources don't leak.
   */
  protected commit(stack: AsyncDisposableStack): void {
    if (this.#disposed || this.#disposables) {
      void stack.disposeAsync().catch(() => undefined);
      throw new Error(
        this.#disposed
          ? "Service.commit() called after dispose"
          : "Service.commit() called more than once",
      );
    }
    this.#disposables = stack;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    // Wait for an in-flight #load() to finish before flipping #disposed.
    // Flipping early would race with a successful commit() at the tail of
    // #load() and turn a normal load completion into a spurious
    // "commit after dispose" rejection.
    await this.ready.catch(() => undefined);
    this.#disposed = true;
    const disposables = this.#disposables;
    this.#disposables = undefined;
    await disposables?.disposeAsync();
  }
}

/** Wraps a service startup failure with the container key that produced it. */
export class ServiceInitError extends Error {
  /** The service registration key from `buildServices()`. */
  readonly service: string;

  constructor(service: string, cause: unknown) {
    super(`Service "${service}" failed to initialize`, { cause });
    this.name = "ServiceInitError";
    this.service = service;
  }
}

type ServiceFactory<TServices extends object> = (
  services: Readonly<TServices>,
) => Service<any>;

type ServiceRegistration<TServices extends object> = Record<
  string,
  ServiceFactory<TServices>
>;

type RegisteredServices<TEntry extends ServiceRegistration<any>> = {
  readonly [K in keyof TEntry]: ReturnType<TEntry[K]>;
};

type ValueFactory<TServices extends object> = (
  services: Readonly<TServices>,
) => object;

type ValueRegistration<TServices extends object> = Record<
  string,
  ValueFactory<TServices>
>;

type RegisteredValues<TEntry extends ValueRegistration<any>> = {
  readonly [K in keyof TEntry]: ReturnType<TEntry[K]>;
};

type ServiceErrorHandler = (key: string, error: ServiceInitError) => void;

/**
 * Typed service registry and lifecycle bridge.
 *
 * Each `use()` call accepts exactly one keyed factory. The factory receives the
 * services registered so far, and the returned service is moved into the owning
 * `AsyncDisposableStack`. Factory throws and startup failures are wrapped in
 * `ServiceInitError` (original error preserved as `cause`); the wrapped
 * rejection — not the original — is what dependents awaiting `ready` observe.
 * `ready` failures are reported through the provided error handler in addition
 * to cascading through the dependency chain.
 */
export class ServiceContainer<TServices extends object = {}> {
  readonly #stack: AsyncDisposableStack;
  readonly #onError: ServiceErrorHandler;
  readonly #services = {} as TServices;

  /**
   * @param stack Owns registered service disposal. The caller keeps this stack
   *   and usually commits it with `stack.move()` after plugin startup succeeds.
   * @param onError Receives per-service startup failures.
   */
  constructor(stack: AsyncDisposableStack, onError: ServiceErrorHandler) {
    this.#stack = stack;
    this.#onError = onError;
  }

  get services(): Readonly<TServices> {
    return this.#services;
  }

  /**
   * Register one service and widen the container type with that service key.
   *
   * Duplicate keys and multi-key entries fail synchronously, so `onload()` can
   * roll back already registered services via its local `await using` stack.
   */
  use<const TEntry extends ServiceRegistration<TServices>>(
    entry: TEntry,
  ): ServiceContainer<TServices & RegisteredServices<TEntry>> {
    const { key, value: service } = this.#invokeFactory(entry);
    if (!(service instanceof Service)) {
      throw new TypeError(
        `Service "${key}" factory did not return a Service instance`,
      );
    }

    service.ready = service.ready.catch((cause: unknown) => {
      throw new ServiceInitError(key, cause);
    });

    void service.ready.catch((error: ServiceInitError) => {
      try {
        this.#onError(key, error);
      } catch (reporterError) {
        console.error(`Failed to report service "${key}" init error`, {
          error,
          reporterError,
        });
      }
    });

    const services = this.#services as Record<string, Service<any>>;
    services[key] = this.#stack.use(service);

    return this as unknown as ServiceContainer<
      TServices & RegisteredServices<TEntry>
    >;
  }

  /**
   * Register one non-`Service` injected value and widen the container type with
   * that key. Unlike {@link use}, the value carries no startup or disposal
   * lifecycle: its factory runs once against the services registered so far, and
   * the returned value is stored as-is. Use for stateless dependency bundles
   * (e.g. composable-function contexts) that other services inject but that own
   * no resources.
   */
  useValue<const TEntry extends ValueRegistration<TServices>>(
    entry: TEntry,
  ): ServiceContainer<TServices & RegisteredValues<TEntry>> {
    const { key, value } = this.#invokeFactory(entry);
    (this.#services as Record<string, object>)[key] = value;

    return this as unknown as ServiceContainer<
      TServices & RegisteredValues<TEntry>
    >;
  }

  /** Validate a single-key registration entry and run its factory, wrapping a
   *  factory throw in {@link ServiceInitError}. Shared by {@link use} and
   *  {@link useValue}; the caller owns lifecycle/storage of the result. */
  #invokeFactory<TValue>(
    entry: Record<string, (services: Readonly<TServices>) => TValue>,
  ): { key: string; value: TValue } {
    const key = getServiceKey(entry);
    if (Object.hasOwn(this.#services, key)) {
      throw new Error(`Service "${key}" is already registered`);
    }
    const factory = entry[key];
    if (!factory) {
      throw new Error(`Service "${key}" factory is missing`);
    }
    try {
      return { key, value: factory(this.services) };
    } catch (cause) {
      throw new ServiceInitError(key, cause);
    }
  }
}

function getServiceKey(entry: Record<string, unknown>): string {
  const keys = Object.keys(entry);
  if (keys.length !== 1) {
    throw new Error("ServiceContainer registration expects exactly one entry");
  }

  return keys[0]!;
}
