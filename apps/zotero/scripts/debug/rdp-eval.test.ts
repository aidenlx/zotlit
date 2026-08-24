import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { evalAsync } from "./rdp-eval.js";
import type { Packet } from "./rdp-eval.js";

function createEvaluator(): (source: string) => Promise<Packet> {
  const context = createContext({ setTimeout });
  return async (source) => {
    try {
      return { result: runInContext(source, context) };
    } catch (error) {
      return { exceptionMessage: String(error) };
    }
  };
}

describe("evalAsync", () => {
  it("keeps concurrent evaluation results separate", async () => {
    const evaluate = createEvaluator();
    const options = { pollAttempts: 100, pollMs: 1, resultTtlMs: 1 };

    const first = evalAsync(
      evaluate,
      'new Promise((resolve) => setTimeout(() => resolve("first"), 40))',
      options,
    );
    const second = evalAsync(
      evaluate,
      'new Promise((resolve) => setTimeout(() => resolve("second"), 5))',
      options,
    );

    await expect(first).resolves.toMatchObject({
      result: JSON.stringify("first"),
    });
    await expect(second).resolves.toMatchObject({
      result: JSON.stringify("second"),
    });
  });

  it("returns a startup exception without polling", async () => {
    const evaluate = createEvaluator();
    const pause = async (): Promise<void> => {
      throw new Error("polling started");
    };

    await expect(evalAsync(evaluate, ")", { pause })).resolves.toMatchObject({
      exceptionMessage: expect.stringContaining("SyntaxError"),
    });
  });
});
