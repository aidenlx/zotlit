import type { CitationLookupRequest } from "./lookup";
import type { CitationLookupObservation } from "./observation";

/** Own one editor's observation; change its request after CodeMirror's update. */
export class EditorLookup implements Disposable {
  readonly #observation;
  #generation = 0;
  #disposed = false;

  constructor(
    observe: (changed: () => void) => CitationLookupObservation,
    changed: () => void,
  ) {
    this.#observation = observe(() => {
      if (!this.#disposed) changed();
    });
  }

  get current(): CitationLookupObservation["current"] {
    return this.#observation.current;
  }

  set(request: CitationLookupRequest): void {
    const generation = ++this.#generation;
    queueMicrotask(() => {
      if (this.#disposed || generation !== this.#generation) return;
      this.#observation.set(request);
    });
  }

  [Symbol.dispose](): void {
    this.#disposed = true;
    this.#generation += 1;
    this.#observation[Symbol.dispose]();
  }
}
