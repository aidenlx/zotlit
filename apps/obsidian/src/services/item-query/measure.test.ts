import type { CliHandler, Plugin } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { QUERY_MEASURE_COMMAND, registerQueryMeasureCli } from "./measure";

function measureHandler(): CliHandler {
  const registerCliHandler = vi.fn();
  registerQueryMeasureCli(
    { registerCliHandler, register: () => {} } as unknown as Plugin,
    {
      measure: async () => {
        throw new Error("the run started.");
      },
    },
  );
  const call = registerCliHandler.mock.calls.find(
    ([command]) => command === QUERY_MEASURE_COMMAND,
  );
  return call![3] as CliHandler;
}

describe("zotlit:query-measure cancelAfterMs", () => {
  it.each(["abc", "-5", "1e999", "NaN"])(
    "rejects %j before the run starts",
    async (cancelAfterMs) => {
      await expect(measureHandler()({ cancelAfterMs })).rejects.toThrow(
        `cancelAfterMs '${cancelAfterMs}' is not a time in milliseconds: use a number from 0.`,
      );
    },
  );
});

describe("zotlit:query-measure heap", () => {
  it("rejects a value before the run starts", async () => {
    await expect(measureHandler()({ heap: "garbage" })).rejects.toThrow(
      "heap is a switch: name it alone, as heap.",
    );
  });
});

describe("zotlit:query-measure parameters", () => {
  it.each<[Record<string, string>, string]>([
    [{ cancelAfterMs: "" }, "cancelAfterMs requires a value."],
    [{ "--heap": "true" }, "Parameter '--heap' is not valid: use heap."],
    [
      { "--cancelAfterMs": "10" },
      "Parameter '--cancelAfterMs' is not valid: use cancelAfterMs=<value>.",
    ],
    [{ limit: "0" }, "limit '0' is not a positive integer"],
    [{ colour: "red" }, "Unknown parameter 'colour'"],
  ])("rejects %j before the run starts", async (params, message) => {
    await expect(measureHandler()(params)).rejects.toThrow(message);
  });
});
