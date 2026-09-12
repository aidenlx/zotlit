import { describe, expect, it } from "vitest";

import { partialSuggestions } from "./partial-suggestions";
import { m } from "./test-messages";

describe("partialSuggestions", () => {
  it("takes the vault's registered names over the draft's own scan", () => {
    // The draft calls "cite" and nothing else; the vault holds two partials.
    const config = partialSuggestions(m, ["cite"], {
      names: () => ["authors", "venue-line"],
      create: () => Promise.resolve(null),
    });

    expect(config.partials).toEqual(["authors", "venue-line"]);
    expect(config.createPartial?.label).toBe(m.workbench_partial_new());
  });

  it("falls back to the draft's scan and offers no create entry", () => {
    const config = partialSuggestions(m, ["cite", "summary"], undefined);

    expect(config.partials).toEqual(["cite", "summary"]);
    expect(config.createPartial).toBeUndefined();
  });

  it("hands the create flow the name the reader typed", async () => {
    const asked: string[] = [];
    const config = partialSuggestions(m, [], {
      names: () => [],
      create: (query) => {
        asked.push(query);
        return Promise.resolve("venue-line");
      },
    });

    await expect(config.createPartial!.run("ven")).resolves.toBe("venue-line");
    expect(asked).toEqual(["ven"]);
  });
});
