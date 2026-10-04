// Evaluator vectors: a Filter Expression, one Item, and the value. No database.
import { describe, expect, it } from "vitest";

import type { HydratedItem } from "@zotlit/db/item-query";

import type { QueryItem } from "./fields";
import { evaluate, matches } from "./filter-evaluate";
import { hasBareForm, planFilter } from "./filter-plan";
import type { FilterPlan, FilterProblem } from "./filter-plan";
import type { FilterValue } from "./filter-values";

interface ItemSpec {
  key?: string;
  itemType?: string;
  fields?: Record<string, string>;
  custom?: Record<string, string>;
  creators?: HydratedItem["creators"];
  tags?: readonly string[];
  collections?: readonly (readonly string[])[];
  hasAttachments?: boolean;
}

function item(spec: ItemSpec = {}): QueryItem {
  const instant = Temporal.Instant.from("2020-01-01T00:00:00Z");
  return {
    scan: {
      itemID: 1,
      key: spec.key ?? "ABCD2345",
      itemType: spec.itemType ?? "journalArticle",
      dateAdded: instant,
      dateModified: instant,
    },
    hydrated: {
      fields: new Map(Object.entries(spec.fields ?? {})),
      custom: new Map(Object.entries(spec.custom ?? {})),
      creators: spec.creators ?? [],
      tags: (spec.tags ?? []).map((name) => ({ name, type: 0 })),
      collections: spec.collections ?? [],
      hasAttachments: spec.hasAttachments ?? false,
    },
    customFieldNames: Object.keys(spec.custom ?? {}),
  };
}

/** A journal article with a value of every kind; `publisher` is missing. */
const ARTICLE = item({
  key: "ART2FULL",
  fields: {
    title: "Ecology of Éclairs",
    volume: "12",
    pages: "abc",
    shortTitle: "",
  },
  custom: { mood: "calm", "review.status": "done" },
  creators: [
    {
      firstName: "Ada",
      lastName: "Lovelace",
      fieldMode: 0,
      creatorType: "author",
    },
    {
      firstName: "",
      lastName: "World Health Organization",
      fieldMode: 1,
      creatorType: "author",
    },
    {
      firstName: "Ada",
      lastName: "Lovelace",
      fieldMode: 0,
      creatorType: "editor",
    },
  ],
  tags: ["to-read", "To-Read", "methods"],
  collections: [
    ["Thesis", "Methods"],
    ["Course", "Methods"],
  ],
  hasAttachments: true,
});

function plan(expression: string): FilterPlan {
  const planned = planFilter(expression);
  if ("code" in planned) {
    throw new Error(`${expression}: ${planned.code}: ${planned.message}`);
  }
  return planned;
}

function problem(expression: string): FilterProblem {
  const planned = planFilter(expression);
  if (!("code" in planned)) throw new Error(`${expression} is valid.`);
  return planned;
}

const valueOf = (expression: string, of: QueryItem = ARTICLE): FilterValue =>
  evaluate(plan(expression).root, of);

/** Run each `[expression, value]` vector against the article. */
function vectors(cases: readonly (readonly [string, FilterValue])[]): void {
  it.each(cases)("%s gives %j", (expression, expected) => {
    expect(valueOf(expression)).toEqual(expected);
  });
}

describe("literals and field values", () => {
  vectors([
    ["null", null],
    ["true", true],
    ["1.5", 1.5],
    ['"a\\"b"', 'a"b'],
    ['[1, "a", null]', [1, "a", null]],
    ["(1)", 1],
    ["title", "Ecology of Éclairs"],
    // A Zotero field value is a string, also when it holds digits.
    ["volume", "12"],
    // A known field that the Item lacks is null.
    ["publisher", null],
    ["itemType", "journalArticle"],
    ["key", "ART2FULL"],
    ["attachments", true],
    // One element for each source row, in Zotero's creator order.
    ["creators", ["Ada Lovelace", "World Health Organization", "Ada Lovelace"]],
    // Tags and Collections follow the Item Query string order.
    ["tags", ["methods", "to-read", "To-Read"]],
    ["collections", ["Course/Methods", "Thesis/Methods"]],
    ['custom["review.status"]', "done"],
    ["custom.mood", "calm"],
    ["mood", "calm"],
    ['custom["absent"]', null],
  ]);

  it("gives an Item without relations empty lists and no Attachment", () => {
    const bare = item();

    expect(valueOf("creators", bare)).toEqual([]);
    expect(valueOf("tags", bare)).toEqual([]);
    expect(valueOf("collections", bare)).toEqual([]);
    expect(valueOf("attachments", bare)).toBe(false);
  });
});

describe("equality", () => {
  vectors([
    ['title == "Ecology of Éclairs"', true],
    // Exact: case-sensitive.
    ['title == "ecology of éclairs"', false],
    ['title != "ecology of éclairs"', true],
    // No coercion between types.
    ['1 == "1"', false],
    ['volume == "12"', true],
    ["volume == 12", false],
    ["true == 1", false],
    ['"" == null', false],
    ["0 == false", false],
    ["0 == null", false],
    ["[] == null", false],
    // Null equals only null.
    ["null == null", true],
    ["publisher == null", true],
    ["publisher != null", false],
    ['publisher != "x"', true],
    ["title != null", true],
    // Lists compare position by position; a list is not its one element.
    ['["a", "b"] == ["a", "b"]', true],
    ['["a", "b"] == ["b", "a"]', false],
    ['["a"] == "a"', false],
    ['["a"] == ["a", "a"]', false],
    ["[] == []", true],
    ["[[1], null] == [[1], null]", true],
    ['tags == ["methods", "to-read", "To-Read"]', true],
  ]);

  it("does not normalize Unicode: NFC and NFD forms of one text differ", () => {
    const nfc = "Éclair";
    const nfd = "Éclair";
    const stored = item({ fields: { title: nfd }, tags: [nfd] });

    expect(valueOf(`title == "${nfd}"`, stored)).toBe(true);
    expect(valueOf(`title == "${nfc}"`, stored)).toBe(false);
    expect(valueOf(`tags.contains("${nfc}")`, stored)).toBe(false);
    expect(valueOf(`title.startsWith("${nfc}")`, stored)).toBe(false);
    expect(valueOf(`title.contains("clair")`, stored)).toBe(true);
  });
});

describe("ordered comparison", () => {
  vectors([
    ["1 < 2", true],
    ["2 <= 2", true],
    ["3 > 4", false],
    ["4 >= 5", false],
    // Strings use the Item Query string order: digits lexically, then letters
    // with case and accents as the last difference.
    ['"10" < "9"', true],
    ['"apple" < "Zebra"', true],
    ['"eclair" < "Éclair"', true],
    ['"Éclair" < "Zebra"', true],
    ['"a" >= "a"', true],
    // Different types have no order.
    ['1 < "2"', null],
    ["volume > 3", null],
    ["true > false", null],
    ["[1] < [2]", null],
    // Null on either side.
    ["null < 1", null],
    ['publisher >= "a"', null],
    ["1 <= null", null],
    ["null <= null", null],
  ]);
});

describe("logic and truthiness", () => {
  vectors([
    ["true && true", true],
    ["true && false", false],
    ["false || true", true],
    ["false || false", false],
    // Null, zero, the empty string, and the empty list are falsy.
    ["null || false", false],
    ["null && true", false],
    ['"" || 0', false],
    ["[] || false", false],
    ['"a" && 1', true],
    ["[null] && true", true],
    ["!true", false],
    ['!""', true],
    ["![]", true],
    ['!"a"', false],
    ["!0", true],
    // `!` of null is null.
    ["!null", null],
    ["!publisher", null],
    ["!attachments", false],
    // The right side does not run when the left side decides.
    ["false && (1 / 0) > 0", false],
  ]);

  it("treats a null filter value as no match", () => {
    expect(matches(plan('publisher > "a"').root, ARTICLE)).toBe(false);
    expect(matches(plan("!publisher").root, ARTICLE)).toBe(false);
    expect(matches(plan("title").root, ARTICLE)).toBe(true);
    expect(matches(plan("shortTitle").root, ARTICLE)).toBe(false);
  });
});

describe("arithmetic", () => {
  vectors([
    ["1 + 2", 3],
    ["5 - 7", -2],
    ["3 * 4", 12],
    ["7 / 2", 3.5],
    ["7 % 4", 3],
    ["-(2 + 3)", -5],
    ["1 + 2 * 3", 7],
    // `+` joins text and joins lists.
    ['"a" + "b"', "ab"],
    ['"a" + 1', "a1"],
    ['1 + "a"', "1a"],
    ['"a" + null', "a"],
    ['title + " (" + volume + ")"', "Ecology of Éclairs (12)"],
    ["[1] + [2, 3]", [1, 2, 3]],
    // Null and a value of another type give null.
    ["1 + null", null],
    ["null - 1", null],
    ["null * null", null],
    ["true + 1", null],
    ["[1] + 1", null],
    ['"a" - 1', null],
    ['"a" * "b"', null],
    ["volume * 2", null],
    ["publisher + 1", null],
    ["-null", null],
    ['-"a"', null],
    ["-title", null],
    // A result outside the finite numbers is null.
    ["1 / 0", null],
    ["0 / 0", null],
    ["1 % 0", null],
  ]);
});

describe("if", () => {
  vectors([
    ['if(true, "a", "b")', "a"],
    ['if(false, "a", "b")', "b"],
    ['if(false, "a")', null],
    ['if(null, "a", "b")', "b"],
    ['if(publisher, publisher, "none")', "none"],
    ['if(title, title.lower(), "none")', "ecology of éclairs"],
    // Only the selected branch runs.
    ["if(true, 1, 1 / 0)", 1],
    ['if(tags.contains("methods"), volume, pages)', "12"],
  ]);
});

describe("global functions", () => {
  vectors([
    ["number(3)", 3],
    ['number("12")', 12],
    ['number("3.5 pages")', 3.5],
    ["number(volume)", 12],
    ["number(volume) > 3", true],
    ["number(true)", 1],
    ["number(false)", 0],
    // An unparseable value is null for the Item.
    ['number("abc")', null],
    ["number(pages)", null],
    ["number(pages) > 3", null],
    ["number(null)", null],
    ["number(publisher)", null],
    ["number([1])", null],
    ['number("")', null],
    ["min(3, 1, 2)", 1],
    ["max(3, 1, 2)", 3],
    ["min(5)", 5],
    ["max(number(volume), 20)", 20],
    ["min(1, null)", null],
    ["max(number(pages), 1)", null],
  ]);
});

describe("methods of every value", () => {
  vectors([
    ["title.toString()", "Ecology of Éclairs"],
    ["(12).toString()", "12"],
    ["true.toString()", "true"],
    ["null.toString()", "null"],
    ["publisher.toString()", "null"],
    ['["a", 1, null].toString()', "a, 1, null"],
    ['title.isType("string")', true],
    ['title.isType("number")', false],
    ['title.isType("any")', true],
    ['(1).isType("number")', true],
    ['true.isType("boolean")', true],
    ['tags.isType("list")', true],
    ['publisher.isType("null")', true],
    ['publisher.isType("string")', false],
    ['publisher.isType("any")', true],
    ["title.isType(publisher)", null],
  ]);
});

describe("string methods", () => {
  vectors([
    ['title.contains("Ecology")', true],
    // Exact: `contains` does not ignore case.
    ['title.contains("ecology")', false],
    ['title.lower().contains("ecology")', true],
    ['title.contains("Éclairs")', true],
    ['title.contains("Eclairs")', false],
    ['title.contains("")', true],
    ['title.startsWith("Ecology")', true],
    ['title.startsWith("ecology")', false],
    ['title.endsWith("Éclairs")', true],
    ['title.endsWith("éclairs")', false],
    ['title.containsAny("zzz", "of")', true],
    ['title.containsAny("zzz", "OF")', false],
    ["title.containsAny()", false],
    ['title.containsAll("Ecology", "of")', true],
    ['title.containsAll("Ecology", "zzz")', false],
    ["title.containsAll()", true],
    ["title.lower()", "ecology of éclairs"],
    ["title.isEmpty()", false],
    ["shortTitle.isEmpty()", true],
    ['"".isEmpty()', true],
    ["title.length", 18],
    ['"".length', 0],
    ['"🧪".length', 2],
    ["title[0]", "E"],
    ["title[-1]", "s"],
    ["title[99]", null],
    // A method on a missing value is null; `isEmpty` of null is true.
    ['publisher.contains("a")', null],
    ["publisher.lower()", null],
    ["publisher.length", null],
    ["publisher.isEmpty()", true],
    ["publisher[0]", null],
    // A null argument gives null.
    ["title.contains(publisher)", null],
    ["title.startsWith(null)", null],
    ['title.containsAny("of", publisher)', null],
  ]);

  it.each([
    // Turkish dotted capital I: `lower` gives `i` and a combining dot.
    ["İstanbul", 'title.lower() == "i̇stanbul"', true],
    ["İstanbul", 'title.lower() == "istanbul"', false],
    // The Kelvin sign is not the letter K, and `lower` folds it to `k`.
    ["K 50", 'title.contains("K")', false],
    ["K 50", 'title.lower().startsWith("k")', true],
    // SQL wildcard characters are plain text.
    ["50%_off \\ x", 'title.contains("%_")', true],
    ["50%_off \\ x", 'title.contains("5_%")', false],
    ["50%_off \\ x", 'title.contains("\\\\")', true],
    ["50 off", 'title.contains("%")', false],
    // An emoji is two code units.
    ["a 🧪 b", 'title.contains("🧪")', true],
    ["a 🧪 b", "title.length", 6],
  ])("on the title %j, %s gives %j", (title, expression, expected) => {
    expect(valueOf(expression, item({ fields: { title } }))).toEqual(expected);
  });
});

describe("number methods", () => {
  vectors([
    ["(2.5).round()", 3],
    ["(2.4).round()", 2],
    ["(3.14159).round(2)", 3.14],
    ["(1234).round(-2)", 1200],
    ["(2.1).ceil()", 3],
    ["(2.9).floor()", 2],
    ["(-3).abs()", 3],
    ["(0).isEmpty()", false],
    ["number(volume).round()", 12],
    // The value is a string on this Item, so a number method is null.
    ["number(pages).round()", null],
    ["(2.5).round(null)", null],
  ]);
});

describe("list methods", () => {
  vectors([
    ['tags.contains("to-read")', true],
    ['tags.contains("To-Read")', true],
    ['tags.contains("TO-READ")', false],
    ['tags.contains("to")', false],
    ["tags.contains(null)", false],
    ["[1, null].contains(null)", true],
    ['[1, 2].contains("1")', false],
    ['tags.containsAny("x", "methods")', true],
    ['tags.containsAny(["x", "methods"])', true],
    ['tags.containsAny("x", "y")', false],
    ["tags.containsAny()", false],
    ['tags.containsAll("to-read", "methods")', true],
    ['tags.containsAll(["to-read", "x"])', false],
    ["tags.isEmpty()", false],
    ["[].isEmpty()", true],
    ["tags.length", 3],
    ["[].length", 0],
    ["tags[0]", "methods"],
    ["tags[-1]", "To-Read"],
    ["tags[3]", null],
    ["tags[-4]", null],
    ["tags[0.5]", null],
    ['tags["0"]', null],
    ["tags[null]", null],
    ['tags[0].startsWith("meth")', true],
    // The type of an element depends on the Item: another type gives null.
    ["[1][0].lower()", null],
    ['[1][0].contains("a")', null],
  ]);
});

describe("relation lists", () => {
  vectors([
    // The same person as author and as editor is two elements.
    ["creators.length", 3],
    ['creators.contains("Ada Lovelace")', true],
    ['creators.contains("World Health Organization")', true],
    ['creators.contains("Lovelace")', false],
    ["creators[0] == creators[2]", true],
    [
      'creators == ["Ada Lovelace", "World Health Organization", "Ada Lovelace"]',
      true,
    ],
    ['creators == ["Ada Lovelace", "World Health Organization"]', false],
    // A Collection element is its root-first path.
    ['collections.contains("Thesis/Methods")', true],
    ['collections.contains("Methods")', false],
    ['collections.contains("Thesis")', false],
    ["collections.length", 2],
    // `within` matches the Collection and every Collection below it.
    ['collections.within("Thesis")', true],
    ['collections.within("Thesis/Methods")', true],
    ['collections.within("Course")', true],
    ['collections.within("Methods")', false],
    ['collections.within("Thes")', false],
    ['collections.within("Thesis/Methods/Deep")', false],
    ['collections.within("thesis")', false],
    ["collections.within(publisher)", null],
  ]);
});

describe("validation", () => {
  it.each([
    ["", "invalid-filter", [0, 0]],
    ["   ", "invalid-filter", [3, 3]],
    ['title == "a', "invalid-filter", [11, 11]],
    ["title ==", "invalid-filter", [8, 8]],
    ["title.contains(/ab/)", "invalid-filter", [15, 19]],
    ["(title)(1)", "invalid-filter", [0, 7]],
    ["custom[mood]", "invalid-filter", [7, 11]],
    ['noSuchFunction("a")', "unknown-function", [0, 14]],
    ['title.noSuchMethod("a")', "unknown-function", [6, 18]],
    // Function names are case-sensitive.
    ['title.startswith("a")', "unknown-function", [6, 16]],
    // A method that exists for another type than the subject has.
    ['tags.startsWith("a")', "unknown-function", [5, 15]],
    ["title.round()", "unknown-function", [6, 11]],
    ["attachments.isEmpty()", "unknown-function", [12, 19]],
    ['title.within("a")', "unknown-function", [6, 12]],
    // A global function called as a method, and a method called as a global.
    ["title.number()", "unknown-function", [6, 12]],
    ['contains(title, "a")', "unknown-function", [0, 8]],
    ["title.startsWith()", "wrong-argument-count", [0, 18]],
    ['title.startsWith("a", "b")', "wrong-argument-count", [0, 26]],
    ["title.lower(1)", "wrong-argument-count", [0, 14]],
    ["number()", "wrong-argument-count", [0, 8]],
    ["number(1, 2)", "wrong-argument-count", [0, 12]],
    ["min()", "wrong-argument-count", [0, 5]],
    ["if(true)", "wrong-argument-count", [0, 8]],
    ["if(true, 1, 2, 3)", "wrong-argument-count", [0, 17]],
    ["(1).round(1, 2)", "wrong-argument-count", [0, 15]],
    ["tags[0].lower(1)", "wrong-argument-count", [0, 16]],
    ["title.startsWith(1)", "wrong-argument-type", [17, 18]],
    ["title.contains(true)", "wrong-argument-type", [15, 19]],
    ['title.containsAny("a", 2)', "wrong-argument-type", [23, 24]],
    ['title.endsWith(["a"])', "wrong-argument-type", [15, 20]],
    ['min(1, "2")', "wrong-argument-type", [7, 10]],
    ['(1.5).round("2")', "wrong-argument-type", [12, 15]],
    ["title.isType(1)", "wrong-argument-type", [13, 14]],
    ["collections.within(1)", "wrong-argument-type", [19, 20]],
    // The type of the argument is known from the field it reads.
    ["title.startsWith(tags)", "wrong-argument-type", [17, 21]],
    ["tags[0].startsWith(1)", "wrong-argument-type", [19, 20]],
    ["title.lenght", "unknown-property", [6, 12]],
    ["title.Length", "unknown-property", [6, 12]],
    ["attachments.length", "unknown-property", [12, 18]],
    ["(1).length", "unknown-property", [4, 10]],
    // Date fields get their filter value with the date functions.
    ["date", "unfilterable-field", [0, 4]],
    ['dateAdded > "2020"', "unfilterable-field", [0, 9]],
    ["dateModified == null", "unfilterable-field", [0, 12]],
    ["custom", "unfilterable-field", [0, 6]],
    ["custom.isEmpty()", "unfilterable-field", [0, 6]],
    ["min == 1", "unknown-field", [0, 3]],
    ['if == "a"', "unknown-field", [0, 2]],
  ] as const)("rejects %j with %s at %j", (expression, code, [from, to]) => {
    expect(problem(expression)).toMatchObject({ code, span: { from, to } });
  });

  it("gives every problem a message and a hint", () => {
    for (const expression of [
      "",
      "title.contains(/ab/)",
      "noSuchFunction()",
      "tags.startsWith(1)",
      "title.startsWith()",
      "title.startsWith(1)",
      "title.lenght",
      "date",
      "custom",
      "min",
    ]) {
      const { message, hint } = problem(expression);
      expect(message).not.toBe("");
      expect(hint).not.toBe("");
    }
  });

  it("names the function and its parameters when the argument count is wrong", () => {
    expect(problem("title.startsWith()")).toMatchObject({
      message: "startsWith takes 1 argument, not 0.",
      hint: "Call value.startsWith(prefix).",
    });
    expect(problem("if(true)")).toMatchObject({
      message: "if takes 2 to 3 arguments, not 1.",
      hint: "Call if(condition, then, else?).",
    });
    expect(problem("min()")).toMatchObject({
      message: "min takes at least 1 argument, not 0.",
      hint: "Call min(value, ...values).",
    });
  });

  it("tells a method from a global function in the hint", () => {
    expect(problem('contains(title, "a")').hint).toContain(
      "value.contains(...)",
    );
    expect(problem("title.number()").hint).toContain("number(...)");
  });

  // A branch that never runs is validated like every other part.
  it.each([
    ["false && noSuchFunction()", "unknown-function"],
    ["true || title.startsWith(1)", "wrong-argument-type"],
    ["if(true, 1, title.startsWith())", "wrong-argument-count"],
    ["if(false, title.lenght, 1)", "unknown-property"],
    ["if(true, 1, date)", "unfilterable-field"],
    ["true || title.contains(/a/)", "invalid-filter"],
    ["[1, noSuchFunction()].length", "unknown-function"],
  ] as const)("rejects the dead branch of %j with %s", (expression, code) => {
    expect(problem(expression).code).toBe(code);
  });

  it.each([
    // The subject or the argument has a type that depends on the Item.
    'tags[0].contains("a")',
    'if(attachments, title, tags).contains("a")',
    "title.startsWith(tags[0])",
    "title.startsWith(null)",
    "title.startsWith(publisher)",
    "null.isEmpty()",
    "null.lower()",
    "min(number(volume), 3)",
  ])("accepts %j", (expression) => {
    expect(() => plan(expression)).not.toThrow();
  });
});

describe("names", () => {
  it("resolves a bare built-in name to the built-in field, also when a custom field has that name", () => {
    const chapter = item({
      fields: { title: "Built-in", publicationTitle: "Handbook" },
      custom: { title: "Custom", publicationTitle: "Mine" },
    });

    expect(valueOf("title", chapter)).toBe("Built-in");
    expect(valueOf('custom["title"]', chapter)).toBe("Custom");
    expect(valueOf("publicationTitle", chapter)).toBe("Handbook");
    expect(valueOf('custom["publicationTitle"]', chapter)).toBe("Mine");
    expect(valueOf("custom.title", chapter)).toBe("Custom");
  });

  it("reads a name outside the built-in names as a custom field for the source to check", () => {
    expect(plan('mood == "calm"').customFields).toEqual([
      { from: 0, to: 4, name: "mood", bare: true },
    ]);
    expect(plan('custom["review.status"] == "done"').customFields).toEqual([
      { from: 0, to: 23, name: "review.status", bare: false },
    ]);
    expect(plan('Title == "a"').customFields).toMatchObject([
      { name: "Title", bare: true },
    ]);
    expect(plan('title == "a"').customFields).toEqual([]);
  });

  it.each([
    ["mood", true],
    ["Title", true],
    ["my_field$2", true],
    ["étude", true],
    // A built-in field, a base field, a type-specific field, a reserved name.
    ["title", false],
    ["publicationTitle", false],
    ["bookTitle", false],
    ["date", false],
    ["dateAdded", false],
    ["itemType", false],
    ["key", false],
    ["tags", false],
    ["collections", false],
    ["creators", false],
    ["attachments", false],
    ["custom", false],
    // A global function and a keyword.
    ["number", false],
    ["if", false],
    ["min", false],
    ["null", false],
    ["true", false],
    ["false", false],
    // Outside the identifier rule of the grammar.
    ["review.status", false],
    ["my field", false],
    ["2fast", false],
    ['say "hi"', false],
    ["a[0]", false],
    ["back\\slash", false],
    ["", false],
    [" mood", false],
  ])("gives the custom field %j a bare form: %s", (name, expected) => {
    expect(hasBareForm(name)).toBe(expected);
  });
});

describe("hydration needs", () => {
  const needsOf = (expression: string) => plan(expression).needs;

  it("names only the fields and relations the filter reads", () => {
    expect(needsOf('itemType == "book" && key != "A"')).toEqual([{}, {}]);
    expect(needsOf('title.contains("a")')).toEqual([{ builtIn: ["title"] }]);
    expect(needsOf('tags.contains("a") || attachments')).toEqual([
      { relations: ["tags"] },
      { relations: ["attachments"] },
    ]);
    expect(needsOf('custom["review.status"] == mood')).toEqual([
      { custom: ["review.status"] },
      { custom: ["mood"] },
    ]);
    expect(needsOf("true")).toEqual([]);
  });

  it("names a field in a branch that never runs", () => {
    expect(needsOf('false && collections.within("a")')).toEqual([
      { relations: ["collections"] },
    ]);
  });
});
