// Promise test hosts exercise the real scoped service through its bridge.
import { Effect, FileSystem, Layer, Scope, Exit } from "effect";

import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";

import { ExcerptImageService, layerExcerptImage } from "@/services/excerpt-image/service";
import type { ExcerptDeps, ExcerptRequest, ExcerptImageOperation } from "@/services/excerpt-image/service";
import type { ExcerptOutcomeScope } from "@/services/excerpt-image/outcome-scope";

export class ExcerptImageFixture implements AsyncDisposable {
  readonly #stack = new AsyncDisposableStack();
  readonly #runtime;
  readonly #bridge;
  #service?: ExcerptImageService["Service"];
  #closing?: Promise<void>;
  readonly ready;

  constructor(deps: ExcerptDeps = {}, fs = Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({}))) {
    this.#runtime = buildRuntime(layerExcerptImage(deps).pipe(Layer.provide(fs)), this.#stack);
    this.#bridge = this.#runtime.context().then(() => {
      this.#service = this.#runtime.runSync(ExcerptImageService);
      return effectBridge(this.#runtime);
    });
    this.ready = this.#bridge.then(() => {});
  }

  get tagged() {
    return this.#service ?? this.#runtime.runSync(ExcerptImageService);
  }
  get rendererDiagnostics() { return this.#service?.rendererDiagnostics; }
  get queueDiagnostics() { return this.tagged.queueDiagnostics; }
  async resolve(request: ExcerptRequest, signal?: AbortSignal) {
    const snapshot = structuredClone(request);
    await this.ready;
    return (await this.#bridge).runPromise(this.tagged.resolve(snapshot), { signal });
  }
  async stored(request: ExcerptRequest) {
    await this.ready;
    return (await this.#bridge).runPromise(this.tagged.stored(request));
  }
  async clear() {
    await this.ready;
    return (await this.#bridge).runPromise(this.tagged.clear);
  }
  operation(options: { outcomes?: ExcerptOutcomeScope } = {}) {
    const scope = Scope.makeUnsafe();
    const held = this.ready.then(async () => (await this.#bridge).runPromise(
      this.tagged.operation(options).pipe(Effect.provideService(Scope.Scope, scope)),
    ));
    let closed = false;
    return {
      resolve: async (request: ExcerptRequest, signal?: AbortSignal) => {
        if (closed) throw new Error("Excerpt operation ended");
        const operation: ExcerptImageOperation = await held;
        return (await this.#bridge).runPromise(operation.resolve(request), { signal });
      },
      [Symbol.asyncDispose]: async () => {
        if (closed) return;
        closed = true;
        await held;
        await this.#runtime.runPromise(Scope.close(scope, Exit.void));
      },
    };
  }
  [Symbol.asyncDispose]() {
    return this.#closing ??= this.ready.then(() => this.#stack.disposeAsync());
  }
}

/** A Promise fake at a test host's boundary, expressed as the real tag shape. */
export function effectImageResolver(source: Partial<Pick<ExcerptImageFixture, "resolve" | "operation">>) {
  return {
    resolve: (request: ExcerptRequest) => Effect.tryPromise((signal) => source.resolve!(request, signal)),
    operation: (options?: { outcomes?: ExcerptOutcomeScope }) => Effect.acquireDisposable(Effect.sync(() => source.operation!(options))).pipe(Effect.map((operation) => ({
      resolve: (request: ExcerptRequest) => Effect.tryPromise((signal) => operation.resolve(request, signal)),
    }))),
  } satisfies Pick<ExcerptImageService["Service"], "resolve" | "operation">;
}
