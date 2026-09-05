import { describe, expect, it } from "vitest";

import type { ProfileId } from "@/lib/profile-stamp";

import {
  compileCondition,
  flatConditions,
  formatCondition,
  matchCondition,
  ruleItem,
  selectProfileByRules,
} from "./index";
import type { ProfileSelectionRule, RuleCondition } from "./index";

const books = "Bk3Qn7XvT2Lp" as ProfileId;
const papers = "Rz9Wm4YfH6Kd" as ProfileId;

function rule(
  overrides: Partial<ProfileSelectionRule> & { id: string },
): ProfileSelectionRule {
  return {
    scope: { mode: "all" },
    expression: 'itemType == "book"',
    profile: books,
    ...overrides,
  };
}

const available = { isAvailable: (selector: string) => selector !== papers };

describe("condition contract", () => {
  it("compiles item-type equality, negation, and flat groups", () => {
    expect(compileCondition('itemType == "book"')).toEqual({
      condition: { kind: "item-type", negated: false, itemType: "book" },
      problem: null,
    });
    expect(compileCondition('itemType != "book"').condition).toEqual({
      kind: "item-type",
      negated: true,
      itemType: "book",
    });
    expect(compileCondition('!(itemType == "book")').condition).toEqual({
      kind: "item-type",
      negated: true,
      itemType: "book",
    });
    expect(
      compileCondition('itemType != "book" && itemType != "thesis"').condition,
    ).toEqual({
      kind: "group",
      match: "all",
      conditions: [
        { kind: "item-type", negated: true, itemType: "book" },
        { kind: "item-type", negated: true, itemType: "thesis" },
      ],
    });
    expect(compileCondition("").condition).toEqual({
      kind: "group",
      match: "all",
      conditions: [],
    });
    expect(compileCondition(" true ").condition).toEqual({
      kind: "group",
      match: "all",
      conditions: [],
    });
  });

  it("keeps any-groups and nested groups outside the flat editor view", () => {
    const { condition } = compileCondition(
      'itemType == "book" || (itemType == "thesis" && itemType != "letter")',
    );
    expect(condition).toEqual({
      kind: "group",
      match: "any",
      conditions: [
        { kind: "item-type", negated: false, itemType: "book" },
        {
          kind: "group",
          match: "all",
          conditions: [
            { kind: "item-type", negated: false, itemType: "thesis" },
            { kind: "item-type", negated: true, itemType: "letter" },
          ],
        },
      ],
    });
    expect(flatConditions(condition!)).toBeNull();
    expect(
      flatConditions(
        compileCondition('itemType == "book" && itemType != "thesis"')
          .condition!,
      ),
    ).toHaveLength(2);
  });

  it("reports syntax errors, unsupported vocabulary, and unknown item types", () => {
    expect(compileCondition("itemType ==")).toEqual({
      condition: null,
      problem: { code: "syntax", from: 11, to: 11, text: "" },
    });
    expect(compileCondition('title == "book"').problem).toEqual({
      code: "unsupported",
      from: 0,
      to: 15,
      text: 'title == "book"',
    });
    expect(compileCondition('inCollection("ABCD1234")').problem).toMatchObject({
      code: "unsupported",
    });
    expect(compileCondition('itemType == "novel"').problem).toEqual({
      code: "unknown-item-type",
      from: 12,
      to: 19,
      text: '"novel"',
    });
    expect(compileCondition("false").problem).toMatchObject({
      code: "unsupported",
    });
  });

  it("writes the canonical expression and reads it back unchanged", () => {
    const condition: RuleCondition = {
      kind: "group",
      match: "all",
      conditions: [
        { kind: "item-type", negated: false, itemType: "book" },
        { kind: "item-type", negated: true, itemType: "bookSection" },
      ],
    };
    const expression = formatCondition(condition);
    expect(expression).toBe('itemType == "book" && itemType != "bookSection"');
    expect(compileCondition(expression).condition).toEqual(condition);
    expect(
      formatCondition({ kind: "group", match: "all", conditions: [] }),
    ).toBe("true");
    expect(
      formatCondition({
        kind: "group",
        match: "any",
        conditions: [
          { kind: "item-type", negated: false, itemType: "book" },
          {
            kind: "group",
            match: "all",
            conditions: [
              { kind: "item-type", negated: false, itemType: "thesis" },
              { kind: "item-type", negated: true, itemType: "letter" },
            ],
          },
        ],
      }),
    ).toBe(
      'itemType == "book" || (itemType == "thesis" && itemType != "letter")',
    );
  });

  it("matches the Item's type through negation and groups", () => {
    const book = { itemType: "book" };
    const thesis = { itemType: "thesis" };
    const is = compileCondition('itemType == "book"').condition!;
    const isNot = compileCondition('itemType != "book"').condition!;
    const either = compileCondition(
      'itemType == "book" || itemType == "thesis"',
    ).condition!;
    const none = compileCondition(
      '!(itemType == "book" || itemType == "thesis")',
    ).condition!;
    expect(matchCondition(is, book)).toBe(true);
    expect(matchCondition(is, thesis)).toBe(false);
    expect(matchCondition(isNot, book)).toBe(false);
    expect(matchCondition(isNot, thesis)).toBe(true);
    expect(matchCondition(either, thesis)).toBe(true);
    expect(matchCondition(none, thesis)).toBe(false);
    expect(matchCondition(none, { itemType: "letter" })).toBe(true);
  });
});

describe("selectProfileByRules", () => {
  const personalBook = {
    library: { type: "personal" } as const,
    itemType: "book",
  };
  const groupBook = {
    library: { type: "group", groupID: 4200309 } as const,
    itemType: "book",
  };

  it("uses the first matching rule in user order and advances past a valid nonmatch", () => {
    const first = rule({ id: "first", expression: 'itemType == "thesis"' });
    const second = rule({ id: "second", profile: "default" });
    const third = rule({ id: "third", profile: books });
    expect(
      selectProfileByRules([first, second, third], personalBook, available),
    ).toEqual({ outcome: "matched", rule: second, selector: "default" });
    expect(
      selectProfileByRules([first, third, second], personalBook, available),
    ).toEqual({ outcome: "matched", rule: third, selector: books });
    expect(selectProfileByRules([first], personalBook, available)).toEqual({
      outcome: "unmatched",
    });
  });

  it("evaluates a rule only within its Library scope", () => {
    const personalOnly = rule({
      id: "personal",
      scope: { mode: "selected", libraries: [{ type: "personal" }] },
    });
    const groupOnly = rule({
      id: "group",
      scope: { mode: "selected", libraries: [{ type: "group", groupID: 118 }] },
      profile: "default",
    });
    expect(
      selectProfileByRules([groupOnly, personalOnly], personalBook, available),
    ).toEqual({ outcome: "matched", rule: personalOnly, selector: books });
    expect(
      selectProfileByRules([personalOnly, groupOnly], groupBook, available),
    ).toEqual({ outcome: "unmatched" });
    expect(
      selectProfileByRules(
        [personalOnly],
        { library: null, itemType: "book" },
        available,
      ),
    ).toEqual({ outcome: "unmatched" });
  });

  it("stops at an earlier unevaluable in-scope rule instead of advancing", () => {
    const broken = rule({ id: "broken", expression: 'title == "x"' });
    const later = rule({ id: "later" });
    expect(
      selectProfileByRules([broken, later], personalBook, available),
    ).toEqual({
      outcome: "broken",
      rule: broken,
      problem: { code: "unsupported", from: 0, to: 12, text: 'title == "x"' },
    });
    const outOfScope = rule({
      id: "out",
      expression: "itemType ==",
      scope: { mode: "selected", libraries: [{ type: "group", groupID: 118 }] },
    });
    expect(
      selectProfileByRules([outOfScope, later], personalBook, available),
    ).toEqual({ outcome: "matched", rule: later, selector: books });
  });

  it("reports a matching rule whose target is unavailable, distinct from a nonmatch", () => {
    const missing = rule({ id: "missing", profile: papers });
    const later = rule({ id: "later" });
    expect(
      selectProfileByRules([missing, later], personalBook, available),
    ).toEqual({
      outcome: "unavailable-target",
      rule: missing,
      selector: papers,
    });
    const nonmatch = rule({
      id: "nonmatch",
      profile: papers,
      expression: 'itemType == "thesis"',
    });
    expect(
      selectProfileByRules([nonmatch, later], personalBook, available),
    ).toEqual({ outcome: "matched", rule: later, selector: books });
  });

  it("reads the Library and item type of a database Item", () => {
    expect(
      ruleItem({ groupID: null, fields: { itemType: "book" } as never }),
    ).toEqual({ library: { type: "personal" }, itemType: "book" });
    expect(
      ruleItem({ groupID: 118, fields: { itemType: "thesis" } as never }),
    ).toEqual({ library: { type: "group", groupID: 118 }, itemType: "thesis" });
  });
});
