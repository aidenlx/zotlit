// The state of a stored Profile Match, before any Item is tested.
import { describe, expect, it } from "vitest";

import type { MatchTree } from "@zotlit/templates/facade";

import { compileProfileMatch, describeMatch } from "./index";

describe("compileProfileMatch", () => {
  it("reads no Match as absent", () => {
    expect(compileProfileMatch(undefined).state).toBe("absent");
  });

  it.each<[string, MatchTree]>([
    ["an empty All group", { and: [] }],
    ["an empty None group", { not: [] }],
  ])("reads %s as a Match for every Item", (_, tree) => {
    expect(compileProfileMatch(tree).state).toBe("all");
  });

  it.each<[string, MatchTree, string]>([
    ["one condition", 'itemType == "book"', 'itemType == "book"'],
    [
      "an Any group",
      { or: ['itemType == "book"', 'tags.contains("to-read")'] },
      '(itemType == "book") || (tags.contains("to-read"))',
    ],
    [
      "a None group",
      { not: ['library == "personal"', 'collections.within("Archive")'] },
      '!((library == "personal") || (collections.within("Archive")))',
    ],
    ["an empty Any group", { or: [] }, "false"],
    ["any Item field", 'title.contains("memory")', 'title.contains("memory")'],
  ])("plans %s as one Items filter", (_, tree, filter) => {
    expect(compileProfileMatch(tree)).toMatchObject({
      state: "evaluable",
      filter,
    });
    expect(describeMatch(tree)).toBe(filter);
  });

  it.each<[string, MatchTree]>([
    ["a syntax mistake", { and: ['itemType == "book" &&'] }],
    ["an unknown method", 'tags.contain("to-read")'],
  ])("tells the mistake of %s", (_, tree) => {
    const match = compileProfileMatch(tree);
    expect(match.state).toBe("unevaluable");
    expect(match.state === "unevaluable" && match.problem).not.toBe("");
  });
});
