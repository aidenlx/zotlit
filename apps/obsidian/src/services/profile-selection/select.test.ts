import { describe, expect, it } from "vitest";

import type { ProfileId } from "@/lib/profile-stamp";

import {
  compileCondition,
  compileFilter,
  formatCondition,
  matchCondition,
  ruleItem,
  selectProfileByRules,
} from "./index";
import type {
  ProfileSelectionRule,
  RuleCondition,
  RuleItemFacts,
} from "./index";

const books = "Bk3Qn7XvT2Lp" as ProfileId;
const papers = "Rz9Wm4YfH6Kd" as ProfileId;

const itemType = (value: string, negated = false): RuleCondition => ({
  kind: "item-type",
  operator: "is",
  negated,
  values: [value],
});

function rule(
  overrides: Partial<ProfileSelectionRule> & { id: string },
): ProfileSelectionRule {
  return {
    scope: { mode: "all" },
    filter: 'itemType == "book"',
    profile: books,
    ...overrides,
  };
}

const available = {
  isAvailable: (selector: string) => selector !== papers,
};

/** A My Library Item with no memberships unless given. */
function facts(overrides: Partial<RuleItemFacts> = {}): RuleItemFacts {
  return {
    library: { type: "personal" },
    itemType: "book",
    tags: [],
    collections: [],
    ...overrides,
  };
}

describe("condition contract", () => {
  it("compiles item-type equality, negation, and flat groups", () => {
    expect(compileCondition('itemType == "book"')).toEqual({
      condition: itemType("book"),
      problem: null,
    });
    expect(compileCondition('itemType != "book"').condition).toEqual({
      ...itemType("book", true),
    });
    expect(compileCondition('!(itemType == "book")').condition).toEqual({
      ...itemType("book", true),
    });
    expect(
      compileCondition('itemType != "book" && itemType != "thesis"').condition,
    ).toEqual({
      kind: "group",
      match: "all",
      conditions: [itemType("book", true), itemType("thesis", true)],
    });
    expect(compileCondition(" true ").condition).toEqual({
      kind: "group",
      match: "all",
      conditions: [],
    });
  });

  it("compiles any-groups and nested groups", () => {
    const { condition } = compileCondition(
      'itemType == "book" || (itemType == "thesis" && itemType != "letter")',
    );
    expect(condition).toEqual({
      kind: "group",
      match: "any",
      conditions: [
        itemType("book"),
        {
          kind: "group",
          match: "all",
          conditions: [itemType("thesis"), itemType("letter", true)],
        },
      ],
    });
  });

  it("compiles a filter tree: explicit groups over leaves, first problem wins", () => {
    expect(
      compileFilter({
        and: [
          'itemType != "book"',
          {
            or: [
              'tags.contains("Read")',
              'tags.contains("Read") && itemType == "thesis"',
            ],
          },
        ],
      }).condition,
    ).toEqual({
      kind: "group",
      match: "all",
      conditions: [
        itemType("book", true),
        {
          kind: "group",
          match: "any",
          conditions: [
            {
              kind: "tags",
              operator: "contains",
              negated: false,
              values: ["Read"],
            },
            {
              kind: "group",
              match: "all",
              conditions: [
                {
                  kind: "tags",
                  operator: "contains",
                  negated: false,
                  values: ["Read"],
                },
                itemType("thesis"),
              ],
            },
          ],
        },
      ],
    });
    // An empty "and" holds for every Item; a lone leaf needs no group.
    expect(compileFilter({ and: [] }).condition).toEqual({
      kind: "group",
      match: "all",
      conditions: [],
    });
    expect(compileFilter('itemType == "book"').condition).toEqual({
      ...itemType("book"),
    });
    expect(
      compileFilter({ or: ['itemType == "book"', "", 'title == "x"'] }).problem,
    ).toEqual({ code: "empty", from: 0, to: 0, text: "" });
  });

  it("reports blank, syntax errors, unsupported vocabulary, and unknown item types", () => {
    expect(compileCondition("  ").problem).toEqual({
      code: "empty",
      from: 0,
      to: 0,
      text: "",
    });
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
    expect(
      compileCondition('collections.within("Project")').problem,
    ).toBeNull();
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
      conditions: [itemType("book"), itemType("bookSection", true)],
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
          itemType("book"),
          {
            kind: "group",
            match: "all",
            conditions: [itemType("thesis"), itemType("letter", true)],
          },
        ],
      }),
    ).toBe(
      'itemType == "book" || (itemType == "thesis" && itemType != "letter")',
    );
  });

  it("matches the Item's type through negation and groups", () => {
    const book = facts();
    const thesis = facts({ itemType: "thesis" });
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
    expect(matchCondition(none, facts({ itemType: "letter" }))).toBe(true);
  });

  it("compiles Collection paths and Tag predicates", () => {
    expect(compileCondition('collections.within("Project/Drafts")')).toEqual({
      condition: {
        kind: "collections",
        operator: "within",
        negated: false,
        values: [["Project", "Drafts"]],
      },
      problem: null,
    });
    expect(
      compileCondition('!collections.contains("Project/Drafts")').condition,
    ).toEqual({
      kind: "collections",
      operator: "contains",
      negated: true,
      values: [["Project", "Drafts"]],
    });
    expect(compileCondition('tags.contains("Read Later")').condition).toEqual({
      kind: "tags",
      operator: "contains",
      negated: false,
      values: ["Read Later"],
    });
    expect(compileCondition('!tags.contains("Read Later")').condition).toEqual({
      kind: "tags",
      operator: "contains",
      negated: true,
      values: ["Read Later"],
    });
    expect(compileCondition("hasTag(1)").problem).toEqual({
      code: "unsupported",
      from: 0,
      to: 6,
      text: "hasTag",
    });
    expect(compileCondition('hasTag("Read")').problem).toEqual({
      code: "unsupported",
      from: 0,
      to: 6,
      text: "hasTag",
    });
    expect(compileCondition('inCollection("personal", "A")').problem).toEqual({
      code: "unsupported",
      from: 0,
      to: 12,
      text: "inCollection",
    });
    expect(
      compileCondition('inCollectionDirectly("personal", "A")').problem,
    ).toEqual({
      code: "unsupported",
      from: 0,
      to: 20,
      text: "inCollectionDirectly",
    });
  });

  it.each([
    ['collections.within("Project/Drafts")', "within", [["Project", "Drafts"]]],
    [
      'collections.contains("Project/Drafts")',
      "contains",
      [["Project", "Drafts"]],
    ],
    [
      'collections.containsAny("Project/Drafts", "Other")',
      "containsAny",
      [["Project", "Drafts"], ["Other"]],
    ],
    [
      'collections.containsAll("Project/Drafts", "Other")',
      "containsAll",
      [["Project", "Drafts"], ["Other"]],
    ],
    ["collections.isEmpty()", "isEmpty", []],
  ] as const)(
    "compiles, negates, and formats %s",
    (expression, operator, values) => {
      const condition = compileCondition(expression).condition;
      expect(condition).toEqual({
        kind: "collections",
        operator,
        negated: false,
        values,
      });
      expect(formatCondition(condition!)).toBe(expression);
      const negated = compileCondition(`!${expression}`).condition;
      expect(formatCondition(negated!)).toBe(`!${expression}`);
    },
  );

  it.each([
    ['tags.contains("Read")', "contains", ["Read"]],
    ['tags.containsAny("Read", "To read")', "containsAny", ["Read", "To read"]],
    ['tags.containsAll("Read", "To read")', "containsAll", ["Read", "To read"]],
    ["tags.isEmpty()", "isEmpty", []],
  ] as const)("compiles and formats %s", (expression, operator, values) => {
    const condition = compileCondition(expression).condition;
    expect(condition).toEqual({
      kind: "tags",
      operator,
      negated: false,
      values,
    });
    expect(formatCondition(condition!)).toBe(expression);
    const negated = compileCondition(`!${expression}`).condition;
    expect(negated).toEqual({
      kind: "tags",
      operator,
      negated: true,
      values,
    });
    expect(formatCondition(negated!)).toBe(`!${expression}`);
  });

  it.each<{ condition: RuleCondition; expression: string }>([
    {
      condition: {
        kind: "tags",
        operator: "isEmpty",
        negated: false,
        values: ["Read", "Review"],
      },
      expression: "tags.isEmpty()",
    },
    {
      condition: {
        kind: "tags",
        operator: "isEmpty",
        negated: true,
        values: ["Read", "Review"],
      },
      expression: "!tags.isEmpty()",
    },
    {
      condition: {
        kind: "collections",
        operator: "isEmpty",
        negated: false,
        values: [
          ["Future", "Research"],
          ["Personal only", "Personal child"],
        ],
      },
      expression: "collections.isEmpty()",
    },
    {
      condition: {
        kind: "collections",
        operator: "isEmpty",
        negated: true,
        values: [
          ["Future", "Research"],
          ["Personal only", "Personal child"],
        ],
      },
      expression: "!collections.isEmpty()",
    },
  ])(
    "formats a populated zero-arity condition as $expression",
    ({ condition, expression }) => {
      expect(formatCondition(condition)).toBe(expression);
    },
  );

  it.each([
    'hasTag("Read")',
    'labels.contains("Read")',
    'tags.includes("Read")',
    "tags.contains()",
    'tags.contains("Read", "Later")',
    "tags.containsAny()",
    "tags.containsAll()",
    'tags.isEmpty("Read")',
    "tags.contains(1)",
    'tags.containsAny("Read", 1)',
  ])("reports unsupported Tag expression %s", (expression) => {
    expect(compileCondition(expression)).toEqual({
      condition: null,
      problem: expect.objectContaining({ code: "unsupported" }),
    });
  });

  it.each([
    'collections.includes("Project")',
    "collections.within()",
    'collections.within("Project", "Drafts")',
    "collections.contains()",
    'collections.contains("Project", "Drafts")',
    "collections.containsAny()",
    "collections.containsAll()",
    'collections.isEmpty("Project")',
    "collections.contains(1)",
    'collections.containsAny("Project", 1)',
    'tags.within("Project")',
  ])("reports unsupported Collection expression %s", (expression) => {
    expect(compileCondition(expression)).toEqual({
      condition: null,
      problem: expect.objectContaining({ code: "unsupported" }),
    });
  });

  it.each([
    { expression: "tags.contains(1)", from: 14, to: 15, text: "1" },
    {
      expression: 'tags.containsAny("Read", 1)',
      from: 25,
      to: 26,
      text: "1",
    },
  ] as const)(
    "reports the offending argument range for $expression",
    ({ expression, from, to, text }) => {
      expect(compileCondition(expression).problem).toEqual({
        code: "unsupported",
        from,
        to,
        text,
      });
    },
  );

  it("writes Collection and Tag conditions canonically and reads them back", () => {
    const condition: RuleCondition = {
      kind: "group",
      match: "all",
      conditions: [
        compileCondition('collections.within("Project")').condition!,
        compileCondition('!collections.contains("Project/Drafts")').condition!,
        {
          kind: "tags",
          operator: "contains",
          negated: false,
          values: ['say "hi"'],
        },
        itemType("book"),
      ],
    };
    const expression = formatCondition(condition);
    expect(expression).toBe(
      'collections.within("Project") && !collections.contains("Project/Drafts") && tags.contains("say \\"hi\\"") && itemType == "book"',
    );
    expect(compileCondition(expression).condition).toEqual(condition);
  });

  it("matches Collection paths by segments and direct path equality", () => {
    const item = facts({
      collections: [["Project", "Drafts", "2024"], ["Other"]],
    });
    const match = (expression: string, subject = item) =>
      matchCondition(compileCondition(expression).condition!, subject);
    expect(match('collections.within("Project/Drafts")')).toBe(true);
    expect(match('collections.within("Project/Draft")')).toBe(false);
    expect(match('collections.contains("Project/Drafts")')).toBe(false);
    expect(match('collections.contains("Project/Drafts/2024")')).toBe(true);
    expect(match('collections.containsAny("Missing", "Other")')).toBe(true);
    expect(
      match('collections.containsAll("Other", "Project/Drafts/2024")'),
    ).toBe(true);
    expect(match('collections.containsAll("Other", "Missing")')).toBe(false);
    expect(match("collections.isEmpty()", facts())).toBe(true);
    expect(match("!collections.isEmpty()", facts())).toBe(false);
    expect(match('collections.within("Unknown/Path")')).toBe(false);
  });

  it("matches exact Tag names", () => {
    // Tagged "Read"
    // (manual) and "READ" (automatic) — both reach the facts as names.
    const item = facts({
      tags: ["Read", "READ"],
    });
    const match = (expression: string, subject = item) =>
      matchCondition(compileCondition(expression).condition!, subject);
    expect(match('tags.contains("Read")')).toBe(true);
    expect(match('tags.contains("READ")')).toBe(true);
    expect(match('tags.contains("read")')).toBe(false);
    expect(match('!tags.contains("read")')).toBe(true);
    expect(match('tags.containsAny("missing", "Read")')).toBe(true);
    expect(match('tags.containsAll("Read", "READ")')).toBe(true);
    expect(match('tags.containsAll("Read", "missing")')).toBe(false);
    expect(match("tags.isEmpty()", facts())).toBe(true);
    expect(match("!tags.isEmpty()", facts())).toBe(false);
    expect(match('tags.contains("Read") && itemType == "book"')).toBe(true);
    expect(match('tags.contains("Read") && itemType == "thesis"')).toBe(false);
  });
});

describe("selectProfileByRules", () => {
  const personalBook = facts();
  const groupBook = facts({ library: { type: "group", groupID: 4200309 } });

  it("uses the first matching rule in user order and advances past a valid nonmatch", () => {
    const first = rule({ id: "first", filter: 'itemType == "thesis"' });
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
      selectProfileByRules([personalOnly], facts({ library: null }), available),
    ).toEqual({ outcome: "unmatched" });
  });

  it("stops at an earlier unevaluable in-scope rule instead of advancing", () => {
    const broken = rule({ id: "broken", filter: 'title == "x"' });
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
      filter: "itemType ==",
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
      filter: 'itemType == "thesis"',
    });
    expect(
      selectProfileByRules([nonmatch, later], personalBook, available),
    ).toEqual({ outcome: "matched", rule: later, selector: books });
  });

  it("treats an unknown Collection path as an ordinary nonmatch", () => {
    const stale = rule({
      id: "stale",
      filter: 'collections.within("Unknown/Path")',
    });
    const later = rule({ id: "later" });
    expect(
      selectProfileByRules([stale, later], personalBook, available),
    ).toEqual({ outcome: "matched", rule: later, selector: books });
    const elsewhere = rule({
      id: "elsewhere",
      filter: 'collections.within("Project")',
      profile: "default",
    });
    expect(
      selectProfileByRules([elsewhere, later], personalBook, available),
    ).toEqual({ outcome: "matched", rule: later, selector: books });
    expect(
      selectProfileByRules(
        [elsewhere, later],
        facts({ collections: [["Project", "Drafts"]] }),
        available,
      ),
    ).toEqual({ outcome: "matched", rule: elsewhere, selector: "default" });
  });

  it("reads the Library, item type, and memberships of a database Item", () => {
    const memberships = {
      tags: ["Read"],
      collections: [["Project", "Drafts"]],
    };
    expect(
      ruleItem(
        { libraryID: 1, groupID: null, fields: { itemType: "book" } as never },
        memberships,
      ),
    ).toEqual({
      library: { type: "personal" },
      itemType: "book",
      ...memberships,
    });
    expect(
      ruleItem(
        { libraryID: 5, groupID: 118, fields: { itemType: "thesis" } as never },
        memberships,
      ),
    ).toEqual({
      library: { type: "group", groupID: 118 },
      itemType: "thesis",
      ...memberships,
    });
  });

  it("gives an Item of an unknown group Library no selector, so a personal-scoped rule skips it", () => {
    const orphan = ruleItem(
      { libraryID: 7, groupID: null, fields: { itemType: "book" } as never },
      { tags: [], collections: [] },
    );
    expect(orphan.library).toBeNull();
    const personal = rule({
      id: "personal",
      scope: { mode: "selected", libraries: [{ type: "personal" }] },
    });
    expect(selectProfileByRules([personal], orphan, available)).toEqual({
      outcome: "unmatched",
    });
    expect(
      selectProfileByRules([rule({ id: "anywhere" })], orphan, available),
    ).toEqual({
      outcome: "matched",
      rule: rule({ id: "anywhere" }),
      selector: books,
    });
  });
});
