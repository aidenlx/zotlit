import { describe, expect, it } from "vitest";

import type { MatchTree } from "@zotlit/templates/facade";

import type { ProfileId } from "@/lib/profile-stamp";
import type { AvailableLibrary } from "@/services/library-scope/scope";
import type { LiteratureNoteProfile } from "@/services/profile/service";

import {
  compileCondition,
  compileFilter,
  formatCondition,
  matchCondition,
  matchItem,
  compileProfileMatch,
  selectProfileByMatch,
} from "./index";
import type { MatchCondition, MatchItemFacts } from "./index";

const books = "Bk3Qn7XvT2Lp" as ProfileId;
const papers = "Rz9Wm4YfH6Kd" as ProfileId;

const itemType = (value: string, negated = false): MatchCondition => ({
  kind: "item-type",
  operator: "is",
  negated,
  values: [value],
});

const libraries: AvailableLibrary[] = [
  { selector: { type: "personal" }, libraryID: 1, name: null },
  { selector: { type: "group", groupID: 118 }, libraryID: 5, name: "Team" },
  {
    selector: { type: "group", groupID: 4200309 },
    libraryID: 2,
    name: "Archive",
  },
];

/** A My Library Item with no memberships unless given. */
function facts(overrides: Partial<MatchItemFacts> = {}): MatchItemFacts {
  return {
    library: { type: "personal" },
    itemType: "book",
    tags: [],
    collections: [],
    ...overrides,
  };
}

describe("condition contract", () => {
  it("compiles and matches stable Library selectors with equality and negation", () => {
    expect(compileCondition('library == "personal"', libraries)).toEqual({
      condition: {
        kind: "library",
        operator: "is",
        negated: false,
        values: ["personal"],
      },
      problem: null,
    });
    expect(compileCondition('!(library == "group:118")', libraries)).toEqual({
      condition: {
        kind: "library",
        operator: "is",
        negated: true,
        values: ["group:118"],
      },
      problem: null,
    });
    const group = compileFilter(
      { and: ['library == "group:118"', 'itemType == "book"'] },
      libraries,
    ).condition!;
    expect(
      matchCondition(
        group,
        facts({ library: { type: "group", groupID: 118 } }),
      ),
    ).toBe(true);
    expect(
      matchCondition(group, facts({ library: { type: "group", groupID: 5 } })),
    ).toBe(false);
    expect(matchCondition(group, facts())).toBe(false);
    const other = compileCondition(
      'library != "personal"',
      libraries,
    ).condition!;
    expect(matchCondition(other, facts())).toBe(false);
    expect(
      matchCondition(
        other,
        facts({ library: { type: "group", groupID: 118 } }),
      ),
    ).toBe(true);
    expect(formatCondition(other)).toBe('library != "personal"');
  });

  it.each([
    "group:5",
    "group:0",
    "group:0118",
    "group:1e2",
    "personal:1",
    "Team",
    "2",
  ])("reports an unknown Library for %s", (selector) => {
    const expression = `library == "${selector}"`;
    expect(compileCondition(expression, libraries)).toEqual({
      condition: null,
      problem: {
        code: "unknown-library",
        from: 11,
        to: expression.length,
        text: `"${selector}"`,
      },
    });
  });

  it("diagnoses unknown Libraries throughout a tree before matching any Item", () => {
    expect(
      compileFilter(
        { or: ['itemType == "book"', 'library != "group:5"'] },
        libraries,
      ),
    ).toMatchObject({
      condition: null,
      problem: { code: "unknown-library", text: '"group:5"' },
    });
    // A source-only parse still preserves a well-formed selector for the editor.
    expect(compileCondition('library == "group:5"').condition).toEqual({
      kind: "library",
      operator: "is",
      negated: false,
      values: ["group:5"],
    });
  });

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
    const condition: MatchCondition = {
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

  it.each<{ condition: MatchCondition; expression: string }>([
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
    const condition: MatchCondition = {
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

describe("selectProfileByMatch", () => {
  const profile = (
    id: ProfileId,
    match?: MatchTree,
  ): LiteratureNoteProfile => ({
    id,
    label: id === books ? "Books" : "Papers",
    path: "",
    document: "",
    bindings: {},
    match: compileProfileMatch(match, libraries),
  });

  it("selects the unique active match, and reports every overlap without priority", () => {
    const book = profile(books, 'itemType == "book"');
    const paper = profile(papers, 'itemType == "journalArticle"');
    expect(selectProfileByMatch([paper, book], facts())).toEqual({
      outcome: "matched",
      profile: book,
      reason: { profile: "Books" },
    });
    const all = profile(papers, { and: [] });
    expect(selectProfileByMatch([all, book], facts())).toEqual({
      outcome: "overlap",
      candidates: [all, book],
    });
    expect(selectProfileByMatch([book, all], facts())).toEqual({
      outcome: "overlap",
      candidates: [book, all],
    });
  });

  it("skips absent, unevaluable, and empty-any matches while an empty-all matches", () => {
    for (const tree of [
      undefined,
      { or: [] },
      'title == "book"',
      'library == "group:999"',
    ] as const)
      expect(selectProfileByMatch([profile(books, tree)], facts())).toEqual({
        outcome: "unmatched",
      });
    for (const tree of [{ and: [] }, "true"] as const)
      expect(
        selectProfileByMatch([profile(books, tree)], facts()),
      ).toMatchObject({ outcome: "matched", profile: { id: books } });
  });

  it("uses the zotero.org group ID and keeps other facts for an unknown group", () => {
    const memberships = {
      tags: ["Read"],
      collections: [["Project", "Drafts"]],
    };
    expect(
      matchItem(
        { libraryID: 5, groupID: 118, fields: { itemType: "book" } as never },
        memberships,
      ),
    ).toEqual({
      library: { type: "group", groupID: 118 },
      itemType: "book",
      ...memberships,
    });
    const orphan = matchItem(
      { libraryID: 7, groupID: null, fields: { itemType: "book" } as never },
      memberships,
    );
    expect(orphan).toEqual({ library: null, itemType: "book", ...memberships });
    expect(
      selectProfileByMatch([profile(books, 'library == "personal"')], orphan),
    ).toEqual({ outcome: "unmatched" });
    expect(
      selectProfileByMatch([profile(books, 'tags.contains("Read")')], orphan),
    ).toMatchObject({ outcome: "matched" });
  });
});

it("formats an empty any-group as a nonmatch and keeps empty all as a catch-all", () => {
  const emptyAny: MatchCondition = {
    kind: "group",
    match: "any",
    conditions: [],
  };
  const emptyAll: MatchCondition = {
    kind: "group",
    match: "all",
    conditions: [],
  };
  expect(formatCondition(emptyAny)).toBe("!true");
  expect(formatCondition(emptyAll)).toBe("true");
  expect(matchCondition(compileCondition("!true").condition!, facts())).toBe(
    false,
  );
  expect(matchCondition(compileCondition("true").condition!, facts())).toBe(
    true,
  );
});
