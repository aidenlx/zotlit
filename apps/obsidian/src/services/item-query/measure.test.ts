import type { CliHandler, Plugin } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  ITEM_QUERY_MEASURE_COMMAND,
  registerItemQueryMeasureCli,
} from "./measure";

function measureHandler(): CliHandler {
  const registerCliHandler = vi.fn();
  registerItemQueryMeasureCli(
    { registerCliHandler, register: () => {} } as unknown as Plugin,
    {
      answer: async () => {
        throw new Error("the run started.");
      },
    },
  );
  const call = registerCliHandler.mock.calls.find(
    ([command]) => command === ITEM_QUERY_MEASURE_COMMAND,
  );
  return call![3] as CliHandler;
}

describe("zotlit:item-query-measure cancelAfterMs", () => {
  it.each(["abc", "", "-5", "1e999", "NaN"])(
    "rejects %j before the run starts",
    async (cancelAfterMs) => {
      await expect(measureHandler()({ cancelAfterMs })).rejects.toThrow(
        `cancelAfterMs '${cancelAfterMs}' is not a time in milliseconds: use a number from 0.`,
      );
    },
  );
});
