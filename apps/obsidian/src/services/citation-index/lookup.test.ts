import { describe, expect, it } from "vitest";

import { lookupAnswer } from "./__fixtures__/lookup";
import { heldCitekeyOf, heldResolution } from "./lookup";

describe("CitationLookupAnswer", () => {
  const answer = lookupAnswer(
    { absent: { kind: "missing" } },
    { ITEM2345: null },
  );

  it("keeps a newly visible key pending until the held answer covers it", () => {
    expect(heldResolution(null, "absent")).toBeNull();
    expect(heldResolution(answer, "new2026")).toBeNull();
    expect(heldResolution(answer, "absent")).toEqual({ kind: "missing" });
    expect(heldCitekeyOf(null, "ITEM2345")).toBeUndefined();
    expect(heldCitekeyOf(answer, "NEW23456")).toBeUndefined();
    expect(heldCitekeyOf(answer, "ITEM2345")).toBeNull();
  });
});
