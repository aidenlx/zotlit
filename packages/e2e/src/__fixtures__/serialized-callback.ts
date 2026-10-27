import { runInNewContext } from "node:vm";

/** Contains syntax that transforms have historically rewritten with captured helpers. */
export async function serializationProbe() {
  const callback = async ({ value }: { value: number }) => {
    function increment(input: number): number { return input + 1; }
    class Counter {
      readonly #value: number;
      constructor(value: number) { this.#value = value; }
      read() { return this.#value; }
    }
    const counter = new Counter(increment(value));
    let disposed = false;
    {
      await using resource = {
        [Symbol.asyncDispose]: async () => { disposed = true; },
      };
      void resource;
    }
    return { value: counter?.read(), disposed };
  };
  return await runInNewContext(`(${callback.toString()})(context)`, { context: { value: 41 } });
}
