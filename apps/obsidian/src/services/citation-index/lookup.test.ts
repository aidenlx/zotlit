import { describe, expect, it } from "vitest";

import { lookupAnswer } from "./__fixtures__/lookup";
import { heldCitekeyOf, heldResolution } from "./lookup";

describe("CitationLookupAnswer", () => {
  const answer = lookupAnswer(
    { absent: { kind: "missing" } },
    { ITEM2345: null },
  );

  it("keeps requested absence distinct from an unrequested key in each direction", () => {
    expect(answer.resolve("absent")).toEqual({ kind: "missing" });
    expect(answer.citekeyOf("ITEM2345")).toBeNull();
    expect(() => answer.resolve("ITEM2345")).toThrow(
      'Citation key "ITEM2345" was not requested',
    );
    expect(() => answer.citekeyOf("absent")).toThrow(
      'Indexed Key "absent" was not requested',
    );
  });

  it("keeps a newly visible key pending until the held answer covers it", () => {
    expect(heldResolution(null, "absent")).toBeNull();
    expect(heldResolution(answer, "new2026")).toBeNull();
    expect(heldResolution(answer, "absent")).toEqual({ kind: "missing" });
    expect(heldCitekeyOf(null, "ITEM2345")).toBeUndefined();
    expect(heldCitekeyOf(answer, "NEW23456")).toBeUndefined();
    expect(heldCitekeyOf(answer, "ITEM2345")).toBeNull();
  });
});
