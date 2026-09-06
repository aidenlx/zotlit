import { describe, expect, it } from "vitest";

import type { ProfileId } from "@/lib/profile-stamp";
import { selectorKey } from "@/services/library-scope/scope";
import type { LibrarySelector } from "@/services/library-scope/scope";

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

/** The Collections the "database" holds: My Library PROJ0001 and SUB00001. */
const KNOWN_COLLECTIONS = new Set(["personal/PROJ0001", "personal/SUB00001"]);

const available = {
  isAvailable: (selector: string) => selector !== papers,
  hasCollection: ({
    library,
    key,
  }: {
    library: LibrarySelector;
    key: string;
  }) => KNOWN_COLLECTIONS.has(`${selectorKey(library)}/${key}`),
};

/** A My Library Item with no memberships unless given. */
function facts(overrides: Partial<RuleItemFacts> = {}): RuleItemFacts {
  return {
    library: { type: "personal" },
    itemType: "book",
    tags: [],
    collections: [],
    collectionAncestors: [],
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

  it("compiles Collection and Tag predicates with portable Library references", () => {
    expect(compileCondition('inCollection("personal", "PROJ0001")')).toEqual({
      condition: {
        kind: "collection",
        negated: false,
        library: { type: "personal" },
        key: "PROJ0001",
        descendants: true,
      },
      problem: null,
    });
    expect(
      compileCondition('!inCollectionDirectly("group:118", "PROJ0001")')
        .condition,
    ).toEqual({
      kind: "collection",
      negated: true,
      library: { type: "group", groupID: 118 },
      key: "PROJ0001",
      descendants: false,
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
    expect(
      compileCondition('inCollection("mine", "PROJ0001")').problem,
    ).toEqual({ code: "unknown-library", from: 13, to: 19, text: '"mine"' });
    expect(compileCondition('inCollection("group:0", "X")').problem).toEqual({
      code: "unknown-library",
      from: 13,
      to: 22,
      text: '"group:0"',
    });
    expect(compileCondition('inCollection("personal")').problem).toMatchObject({
      code: "unsupported",
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
    expect(compileCondition('inCollection("personal", "A")').condition).toEqual(
      expect.objectContaining({ kind: "collection" }),
    );
  });

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
        {
          kind: "collection",
          negated: false,
          library: { type: "group", groupID: 118 },
          key: "PROJ0001",
          descendants: true,
        },
        {
          kind: "collection",
          negated: true,
          library: { type: "personal" },
          key: "SUB00001",
          descendants: false,
        },
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
      'inCollection("group:118", "PROJ0001") && !inCollectionDirectly("personal", "SUB00001") && tags.contains("say \\"hi\\"") && itemType == "book"',
    );
    expect(compileCondition(expression).condition).toEqual(condition);
  });

  it("matches memberships: descendants by default, direct only on request, exact Tag names", () => {
    // Filed directly in SUB00001, whose parent is PROJ0001; tagged "Read"
    // (manual) and "READ" (automatic) — both reach the facts as names.
    const item = facts({
      tags: ["Read", "READ"],
      collections: ["SUB00001", "OTHR0001"],
      collectionAncestors: ["PROJ0001"],
    });
    const match = (expression: string, subject = item) =>
      matchCondition(compileCondition(expression).condition!, subject);
    expect(match('inCollection("personal", "PROJ0001")')).toBe(true);
    expect(match('inCollectionDirectly("personal", "PROJ0001")')).toBe(false);
    expect(match('inCollectionDirectly("personal", "SUB00001")')).toBe(true);
    expect(match('inCollection("personal", "OTHR0001")')).toBe(true);
    expect(match('!inCollection("personal", "OTHR0001")')).toBe(false);
    // The same key in another Library is a different Collection.
    expect(match('inCollection("group:118", "PROJ0001")')).toBe(false);
    expect(
      match('inCollection("personal", "PROJ0001")', {
        ...item,
        library: { type: "group", groupID: 118 },
      }),
    ).toBe(false);
    expect(match('inCollection("personal", "PROJ0001")', facts())).toBe(false);
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

  it("breaks on a Collection reference the database lacks instead of advancing", () => {
    const stale = rule({
      id: "stale",
      filter: 'inCollection("personal", "GONE0000")',
    });
    const foreign = rule({
      id: "foreign",
      filter: '!inCollection("group:999", "PROJ0001")',
    });
    const later = rule({ id: "later" });
    expect(
      selectProfileByRules([stale, later], personalBook, available),
    ).toEqual({
      outcome: "broken",
      rule: stale,
      problem: {
        code: "missing-collection",
        library: { type: "personal" },
        key: "GONE0000",
      },
    });
    expect(
      selectProfileByRules([foreign, later], personalBook, available),
    ).toEqual({
      outcome: "broken",
      rule: foreign,
      problem: {
        code: "missing-collection",
        library: { type: "group", groupID: 999 },
        key: "PROJ0001",
      },
    });
    // A known Collection the Item is not in is a valid nonmatch.
    const elsewhere = rule({
      id: "elsewhere",
      filter: 'inCollection("personal", "PROJ0001")',
      profile: "default",
    });
    expect(
      selectProfileByRules([elsewhere, later], personalBook, available),
    ).toEqual({ outcome: "matched", rule: later, selector: books });
    expect(
      selectProfileByRules(
        [elsewhere, later],
        facts({ collections: ["SUB00001"], collectionAncestors: ["PROJ0001"] }),
        available,
      ),
    ).toEqual({ outcome: "matched", rule: elsewhere, selector: "default" });
  });

  it("reads the Library, item type, and memberships of a database Item", () => {
    const memberships = {
      tags: ["Read"],
      collections: ["SUB00001"],
      collectionAncestors: ["PROJ0001"],
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
      { tags: [], collections: [], collectionAncestors: [] },
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
