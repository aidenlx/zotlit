import { describe, expect } from "vitest";

import { fakeCliHost } from "@/lib/__fixtures__/cli-host";
import type { CliCommandHandler } from "@/lib/cli-command";
import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { QUERY_MEASURE_COMMAND, registerQueryMeasureCli } from "./measure";

function measureHandler(): CliCommandHandler {
  const { host, command } = fakeCliHost();
  registerQueryMeasureCli(host, {
    measure: async () => {
      throw new Error("the run started.");
    },
  });
  return command(QUERY_MEASURE_COMMAND).handler;
}

/** The message of the error the handler rejects with before the run starts. */
const rejection = (params: Record<string, string>) =>
  Effect.flip(measureHandler()(params)).pipe(
    Effect.map((error) => {
      expect(error).toBeInstanceOf(TypeError);
      return (error as TypeError).message;
    }),
  );

describe("zotlit:query-measure cancelAfterMs", () => {
  it.effect.each(["abc", "-5", "1e999", "NaN"])(
    "rejects %j before the run starts",
    (cancelAfterMs) =>
      Effect.gen(function* () {
        expect(yield* rejection({ cancelAfterMs })).toContain(
          `cancelAfterMs '${cancelAfterMs}' is not a time in milliseconds: use a number from 0.`,
        );
      }),
  );
});

describe("zotlit:query-measure heap", () => {
  it.effect("rejects a value before the run starts", () =>
    Effect.gen(function* () {
      expect(yield* rejection({ heap: "garbage" })).toContain(
        "heap is a switch: name it alone, as heap.",
      );
    }),
  );
});

describe("zotlit:query-measure parameters", () => {
  it.effect.each<[Record<string, string>, string]>([
    [{ cancelAfterMs: "" }, "cancelAfterMs requires a value."],
    [{ "--heap": "true" }, "Parameter '--heap' is not valid: use heap."],
    [
      { "--cancelAfterMs": "10" },
      "Parameter '--cancelAfterMs' is not valid: use cancelAfterMs=<value>.",
    ],
    [{ limit: "0" }, "limit '0' is not a positive integer"],
    [{ colour: "red" }, "Unknown parameter 'colour'"],
  ])("rejects %j before the run starts", ([params, message]) =>
    Effect.gen(function* () {
      expect(yield* rejection(params)).toContain(message);
    }),
  );
});
