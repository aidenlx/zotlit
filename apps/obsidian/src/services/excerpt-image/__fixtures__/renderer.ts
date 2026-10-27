// A Promise host for the scoped renderer's resource ownership trials.
import { Effect, Layer } from "effect";
import type { FileSystem } from "effect";

import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";

import { ExcerptRenderer } from "@/services/excerpt-image/renderer";
import type { ExcerptRequest } from "@/services/excerpt-image/service";

export class ExcerptRendererFixture implements AsyncDisposable {
  readonly #stack = new AsyncDisposableStack();
  readonly native;
  readonly #runtime;
  readonly #ready;
  constructor(host: ConstructorParameters<typeof ExcerptRenderer>[0], fs: Layer.Layer<FileSystem.FileSystem>) {
    this.native = new ExcerptRenderer(host);
    this.#runtime = buildRuntime(Layer.effectDiscard(
      Effect.addFinalizer(() => this.native.dispose),
    ).pipe(Layer.provideMerge(fs)), this.#stack);
    this.#ready = this.#runtime.context().then((context) => ({ context, bridge: effectBridge(this.#runtime) }));
  }
  get diagnostics() { return this.native.diagnostics; }
  async render(request: ExcerptRequest, signal?: AbortSignal) {
    const { context, bridge } = await this.#ready;
    return bridge.runPromise(this.native.render(request).pipe(Effect.provideContext(context)), { signal });
  }
  async [Symbol.asyncDispose]() {
    await this.#ready;
    await this.#stack.disposeAsync();
  }
}
