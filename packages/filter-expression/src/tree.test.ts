// The Filter Tree: reading a stored filter, folding it, and composing it.
import { describe, expect, it } from "vitest";

import { composeFilterTree, foldFilterTree, readFilterTree } from "./index";
import type { FilterTree } from "./index";

describe("composeFilterTree", () => {
  it.each<[string, FilterTree, string]>([
    ["one expression", 'tags.contains("x")', 'tags.contains("x")'],
    ["an empty and group", { and: [] }, "true"],
    ["an empty or group", { or: [] }, "false"],
    ["an empty not group", { not: [] }, "true"],
    ["a group of one", { or: ["a"] }, "a"],
    ["an and group", { and: ["a", "b"] }, "(a) && (b)"],
    ["an or group", { or: ["a", "b"] }, "(a) || (b)"],
    ["a not group of one", { not: ["a"] }, "!(a)"],
    ["a not group", { not: ["a", "b"] }, "!((a) || (b))"],
    [
      "nested groups",
      { and: ["a", { not: ["b", { or: ["c", "d"] }] }] },
      "(a) && (!((b) || ((c) || (d))))",
    ],
  ])("writes %s", (_, tree, text) => {
    expect(composeFilterTree(tree).text).toBe(text);
  });

  it.each<[string, FilterTree, [string, number[]][]]>([
    ["one expression", "a", [["a", [0]]]],
    ["a group of one", { and: ["a"] }, [["a", [0]]]],
    [
      "a not group",
      { not: ["a", "bb"] },
      [
        ["a", [0]],
        ["bb", [1]],
      ],
    ],
    [
      "nested groups",
      { and: ["a", { not: ["b", { or: ["c", "dd"] }] }] },
      [
        ["a", [0]],
        ["b", [1, 0]],
        ["c", [1, 1, 0]],
        ["dd", [1, 1, 1]],
      ],
    ],
  ])("places each leaf of %s at its own text", (_, tree, expected) => {
    const { text, leaves } = composeFilterTree(tree);
    expect(
      leaves.map((leaf) => [text.slice(leaf.from, leaf.to), leaf.path]),
    ).toEqual(expected);
  });
});

describe("foldFilterTree", () => {
  it("tells each leaf and group its path", () => {
    const seen: string[] = [];
    foldFilterTree(
      { or: ["a", { not: ["b"] }] },
      {
        leaf: (text, path) => void seen.push(`${text}@${path.join(".")}`),
        group: (kind, _, path) => void seen.push(`${kind}@${path.join(".")}`),
      },
    );
    expect(seen).toEqual(["a@0", "b@1.0", "not@1", "or@"]);
  });

  it("reads one expression as the only entry of the root", () => {
    expect(
      foldFilterTree("a", { leaf: (_, path) => path, group: () => [] }),
    ).toEqual([0]);
  });
});

describe("readFilterTree", () => {
  it("reads every group kind", () => {
    expect(
      readFilterTree({ and: ["a", { or: ["b"] }, { not: ["c"] }] }),
    ).toEqual({ and: ["a", { or: ["b"] }, { not: ["c"] }] });
  });

  it("reads a number or a boolean as its text", () => {
    expect(readFilterTree({ or: [1, true] })).toEqual({ or: ["1", "true"] });
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a list", ["a"]],
    ["a map with two keys", { and: [], or: [] }],
    ["an unknown group", { xor: ["a"] }],
    ["a group that is not a list", { and: "a" }],
    ["a bad entry", { and: ["a", { or: null }] }],
  ])("refuses %s", (_, value) => {
    expect(readFilterTree(value)).toBeNull();
  });
});
