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
    await Promise.resolve();
    return { value: counter?.read() };
  };
  return await runInNewContext(`(${callback.toString()})(context)`, { context: { value: 41 } });
}
