import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { partialSuggestions } from "./partial-suggestions";
import { m } from "./test-messages";

describe("partialSuggestions", () => {
  it("takes the vault's registered names over the draft's own scan", () => {
    // The draft calls "cite" and nothing else; the vault holds two partials.
    const config = partialSuggestions(m, ["cite"], {
      run: Effect.runFork,
      partials: {
        names: () => ["authors", "venue-line"],
        create: () => Effect.succeed(null),
      },
    });

    expect(config.partials).toEqual(["authors", "venue-line"]);
    expect(config.createPartial?.label).toBe(m.workbench_partial_new());
  });

  it("falls back to the draft's scan and offers no create entry", () => {
    const config = partialSuggestions(m, ["cite", "summary"], {
      run: Effect.runFork,
      partials: undefined,
    });

    expect(config.partials).toEqual(["cite", "summary"]);
    expect(config.createPartial).toBeUndefined();
  });

  it("hands the create flow the name the reader typed", async () => {
    const asked: string[] = [];
    const config = partialSuggestions(m, [], {
      run: Effect.runFork,
      partials: {
        names: () => [],
        create: (query) => {
          asked.push(query);
          return Effect.succeed("venue-line");
        },
      },
    });

    await expect(
      Effect.runPromise(config.createPartial!.run("ven")),
    ).resolves.toBe("venue-line");
    expect(asked).toEqual(["ven"]);
  });
});
