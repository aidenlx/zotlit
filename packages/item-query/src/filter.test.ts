// Evaluator vectors: a Filter Expression, one Item, and the value. No database.
import { describe, expect, it } from "vitest";

import type { HydratedItem } from "@zotlit/db/item-query";

import type { QueryItem } from "./fields";
import { evaluate, matches } from "./filter-evaluate";
import { hasBareForm, planFilter } from "./filter-plan";
import type { FilterPlan, FilterProblem } from "./filter-plan";
import type { FilterValue } from "./filter-values";
import type { QueryClock } from "./query-clock";

interface ItemSpec {
  key?: string;
  itemType?: string;
  fields?: Record<string, string>;
  custom?: Record<string, string>;
  creators?: HydratedItem["creators"];
  tags?: readonly string[];
  collections?: readonly (readonly string[])[];
  hasAttachments?: boolean;
  /** An ISO instant; defaults to 2020-01-01T00:00:00Z. */
  dateAdded?: string;
}

function item(spec: ItemSpec = {}): QueryItem {
  const epochMilliseconds = (iso: string) =>
    Temporal.Instant.from(iso).epochMilliseconds;
  const instant = epochMilliseconds("2020-01-01T00:00:00Z");
  return {
    scan: {
      itemID: 1,
      key: spec.key ?? "ABCD2345",
      itemType: spec.itemType ?? "journalArticle",
      dateAdded: spec.dateAdded ? epochMilliseconds(spec.dateAdded) : instant,
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
  if ("kind" in planned) {
    throw new Error(`${expression}: ${JSON.stringify(planned)}`);
  }
  return planned;
}

function problem(expression: string): FilterProblem {
  const planned = planFilter(expression);
  if (!("kind" in planned)) throw new Error(`${expression} is valid.`);
  return planned;
}

/** The Query Clock of the vectors: noon UTC, 15 July 2024. */
const CLOCK: QueryClock = {
  now: Temporal.Instant.from("2024-07-15T12:00:00Z"),
  timeZone: "UTC",
};

const valueOf = (
  expression: string,
  of: QueryItem = ARTICLE,
  clock: QueryClock = CLOCK,
): FilterValue => evaluate(plan(expression).root, of, clock);

/** Run each `[expression, value]` vector against the article. */
function vectors(
  cases: readonly (readonly [string, FilterValue])[],
  clock: QueryClock = CLOCK,
): void {
  it.each(cases)("%s gives %j", (expression, expected) => {
    expect(valueOf(expression, ARTICLE, clock)).toEqual(expected);
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
    // Null is falsy, so `!` of null is true.
    ["!null", true],
    ["!publisher", true],
    ['!(publisher > "a")', true],
    ["!attachments", false],
    // The right side does not run when the left side decides.
    ["false && (1 / 0) > 0", false],
  ]);

  it("treats a null filter value as no match", () => {
    expect(matches(plan('publisher > "a"').root, ARTICLE, CLOCK)).toBe(false);
    expect(matches(plan("!publisher").root, ARTICLE, CLOCK)).toBe(true);
    expect(matches(plan("title").root, ARTICLE, CLOCK)).toBe(true);
    expect(matches(plan("shortTitle").root, ARTICLE, CLOCK)).toBe(false);
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
    // min and max take the numbers among their arguments.
    ["min(1, null)", 1],
    ["max(number(pages), 1)", 1],
    ["min(null, 4, 2)", 2],
    ["min()", null],
    ["max(null)", null],
    ["max(number(pages))", null],
    // A date as its Unix time in milliseconds.
    ['number(date("2020-01-15T10:30:00Z"))', 1_579_084_200_000],
    ['number(date("2020-01-15"))', 1_579_046_400_000],
    ["number(dateAdded)", 1_577_836_800_000],
    // date() gives a date as it is.
    ["date(dateAdded) == dateAdded", true],
    ['date(date("2020-01")).toString()', "2020-01"],
    ["date(publisher)", null],
    // list() wraps a value: a list stays, null is the empty list, any other
    // value is a one-element list.
    ["list(tags)", ["methods", "to-read", "To-Read"]],
    ['list(["a"])', ["a"]],
    ["list([])", []],
    ["list(null)", []],
    ["list(publisher)", []],
    ["list(title)", ["Ecology of Éclairs"]],
    ["list(1)", [1]],
    ["list(false)", [false]],
    ["list(mood).length", 1],
    ['list(mood).contains("calm")', true],
    ['list(publisher).contains("calm")', false],
    ["list(publisher).isEmpty()", true],
    ["list(today())[0] == today()", true],
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
    // A type name that comes from the Item's data and names no type.
    ["title.isType(title)", null],
    // isTruthy() is the truthiness of a filter: null, false, zero, the empty
    // text, the empty list, and a zero duration are false.
    ["title.isTruthy()", true],
    ["shortTitle.isTruthy()", false],
    ["publisher.isTruthy()", false],
    ["null.isTruthy()", false],
    ["false.isTruthy()", false],
    ["(0).isTruthy()", false],
    ["(1).isTruthy()", true],
    ["[].isTruthy()", false],
    ["[null].isTruthy()", true],
    ["tags.isTruthy()", true],
    ["attachments.isTruthy()", true],
    ["today().isTruthy()", true],
    ['duration("0d").isTruthy()', false],
    ['duration("1d").isTruthy()', true],
    ['(publisher > "a").isTruthy()', false],
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

describe("text helpers", () => {
  vectors([
    ['"  a b  ".trim()', "a b"],
    ["title.trim()", "Ecology of Éclairs"],
    ['"\\t\\n x \\n".trim()', "x"],
    ["publisher.trim()", null],
    // title() upper-cases the first code point of each word that starts the
    // text or follows whitespace, and leaves the rest as it is.
    ['"hello wORLD".title()', "Hello WORLD"],
    ['"  two  spaces ".title()', "  Two  Spaces "],
    ['"a\\tb\\nc".title()', "A\tB\nC"],
    ['"éclair ßtraße 🧪x".title()', "Éclair SStraße 🧪x"],
    ['"pre-print of-things".title()', "Pre-print Of-things"],
    ['"".title()', ""],
    ["title.title()", "Ecology Of Éclairs"],
    ["publisher.title()", null],
    ['"-".repeat(3)', "---"],
    ['"ab".repeat(0)', ""],
    ['"ab".repeat(1)', "ab"],
    // A count that is negative, not an integer, or above 10 000 gives null;
    // so does a result above 1 000 000 code units.
    ['"ab".repeat(-1)', null],
    ['"ab".repeat(1.5)', null],
    ['"ab".repeat(10000).length', 20_000],
    ['"ab".repeat(10001)', null],
    ['"a".repeat(10000).repeat(100).length', 1_000_000],
    ['"a".repeat(10000).repeat(101)', null],
    ['"ab".repeat(null)', null],
    // A count that comes from the Item and is not a number.
    ['"ab".repeat(tags[0])', null],
    ["publisher.repeat(2)", null],
    // reverse() works by code point, so an emoji survives.
    ['"abc".reverse()', "cba"],
    ['"a🧪b".reverse()', "b🧪a"],
    ['"".reverse()', ""],
    ["title.reverse()", "srialcÉ fo ygolocE"],
    ["publisher.reverse()", null],
    // slice() counts code units, as length and index access do.
    ["title.slice(0, 7)", "Ecology"],
    ["title.slice(11)", "Éclairs"],
    ["title.slice(-7)", "Éclairs"],
    ["title.slice(0, -8)", "Ecology of"],
    ["title.slice(5, 2)", ""],
    ["title.slice(99)", ""],
    ['"a🧪b".slice(1, 3)', "🧪"],
    ["title.slice(null)", null],
    ["title.slice(0, null)", null],
    ["title.slice(tags[0])", null],
    ["publisher.slice(0, 1)", null],
    // replace() with a text pattern replaces every occurrence, with the
    // replacement as literal text.
    ['"a  b  c".replace("  ", " ")', "a b c"],
    ['"aaa".replace("a", "b")', "bbb"],
    ['"abc".replace("x", "y")', "abc"],
    ['"abc".replace("", "-")', "-a-b-c-"],
    ['"a.b".replace(".", "$&$&")', "a$&$&b"],
    ['"abc".replace("b", "")', "ac"],
    ['title.replace("of", "and")', "Ecology and Éclairs"],
    ['title.replace(null, "a")', null],
    ['title.replace("a", null)', null],
    ['title.replace([1][0], "a")', null],
    ['publisher.replace("a", "b")', null],
    // split() gives the parts as a list of texts; n keeps the first n parts.
    ['"a:b:c".split(":")', ["a", "b", "c"]],
    ['"a:b:c".split(":")[0]', "a"],
    ['"a:b:c".split(":", 2)', ["a", "b"]],
    ['"a:b:c".split(":", 0)', []],
    ['"a:b:c".split(":", 9)', ["a", "b", "c"]],
    ['"a:b:c".split(":", 4294967296)', ["a", "b", "c"]],
    ['"abc".split(":")', ["abc"]],
    ['"abc".split("")', ["a", "b", "c"]],
    ['"".split(":")', [""]],
    ['"a::b".split("::")', ["a", "b"]],
    ['"a:b:c".split(":", -1)', null],
    ['"a:b:c".split(":", 1.5)', null],
    ['"a:b".split(":", null)', null],
    ['"a:b".split(null)', null],
    ['"a:b".split([1][0])', null],
    ['title.split(" ").length', 3],
    ['title.split(" ")[1] == "of"', true],
    ['publisher.split(":")', null],
  ]);
});

describe("regular expressions", () => {
  vectors([
    // A /pattern/flags literal is a regexp value; matches(text) tests a text.
    ["/^Eco/.matches(title)", true],
    ["/^eco/.matches(title)", false],
    ["/^eco/i.matches(title)", true],
    ["/clairs$/.matches(title)", true],
    ["/^.{18}$/u.matches(title)", true],
    ["/\\d+/.matches(volume)", true],
    ["/\\d+/.matches(pages)", false],
    ['/to-read/i.matches("TO-READ")', true],
    // g and y stay deterministic: the match position is reset before each test.
    ["/o/g.matches(title) && /o/g.matches(title)", true],
    [
      "[/o/g.matches(title), /o/g.matches(title), /o/g.matches(title)]",
      [true, true, true],
    ],
    ["/Eco/y.matches(title) && /Eco/y.matches(title)", true],
    // One literal, tested once for each element.
    ['["a", "a"].map(/a/g.matches(value))', [true, true]],
    ['["a", "a"].map(/a/y.matches(value))', [true, true]],
    ['["a", "a"].map(value.replace(/a/y, "b"))', ["b", "b"]],
    // A null or wrongly typed argument gives null.
    ["/a/.matches(publisher)", null],
    ["/a/.matches(null)", null],
    ["/a/.matches([1][0])", null],
    // An argument whose type depends on the Item.
    ["/e/.matches(tags[0])", true],
    // replace() with a regexp follows JavaScript: g decides whether the
    // first or every occurrence changes, and $1 names a group.
    ['"a  b   c".replace(/\\s+/g, " ")', "a b c"],
    ['"a  b   c".replace(/\\s+/, " ")', "a b   c"],
    ['"Ada Lovelace".replace(/(\\w+) (\\w+)/, "$2, $1")', "Lovelace, Ada"],
    ['"abc".replace(/B/i, "x")', "axc"],
    ['"abc".replace(/x/, "y")', "abc"],
    ['title.replace(/é/i, "e")', "Ecology of eclairs"],
    ['title.replace(/o/g, "0")', "Ec0l0gy 0f Éclairs"],
    ["title.replace(/o/g, null)", null],
    ['publisher.replace(/o/, "0")', null],
    // split() with a regexp: n keeps the first n parts.
    ['"a:b—c".split(/[:—]/)', ["a", "b", "c"]],
    ['"a:b—c".split(/[:—]/, 2)', ["a", "b"]],
    ['"a1b22c".split(/\\d+/)', ["a", "b", "c"]],
    ['"abc".split(/x/)', ["abc"]],
    ["title.split(/\\s+/)[2]", "Éclairs"],
    ['"a:b:c".split(/:/, 4294967296)', ["a", "b", "c"]],
    // A group that does not take part in the match is null.
    ['"a-b".split(/(-)|(,)/)', ["a", "-", null, "b"]],
    ['"a-b".split(/(-)|(,)/).join("|")', "a|-||b"],
    ["title.split(/ /, -1)", null],
    ["publisher.split(/ /)", null],
    // Equality by source and flags; toString() gives /source/flags.
    ["/a/ == /a/", true],
    ["/a/i == /a/i", true],
    ["/a/ == /a/i", false],
    ["/a/ == /b/", false],
    ['/a/ == "/a/"', false],
    ["/a/ != /a/g", true],
    ["[/a/] == [/a/]", true],
    ["/a/.toString()", "/a/"],
    ["/^the /i.toString()", "/^the /i"],
    ["/a\\/b/.toString()", "/a\\/b/"],
    ['"x" + /a/g', "x/a/g"],
    ['[/a/, /b/].join("|")', "/a/|/b/"],
    // A regexp is truthy, has no order, and names its type.
    ["/a/.isTruthy()", true],
    ["!/a/", false],
    ["/a/ < /b/", null],
    ["/a/ >= /a/", null],
    ['/a/.isType("regexp")', true],
    ['/a/.isType("string")', false],
    ['/a/.isType("any")', true],
    [
      "[/b/, /a/].sort()",
      [
        { type: "regexp", regexp: /b/ },
        { type: "regexp", regexp: /a/ },
      ],
    ],
    ["[null, /a/, 1].sort()", [1, { type: "regexp", regexp: /a/ }, null]],
    ["[/a/, /a/, /a/i].unique().length", 2],
    ["[/a/].contains(/a/)", true],
    ["list(/a/).length", 1],
    // A regexp inside an element expression.
    ["tags.filter(/read/i.matches(value)).length", 2],
    ["creators.map(/^Ada/.matches(value)).contains(false)", true],
  ]);
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
    // toFixed gives a text with that many decimals; a precision outside 0 to
    // 100 gives null.
    ["(1.005).toFixed(2)", "1.00"],
    ["(2).toFixed(1)", "2.0"],
    ["(2.567).toFixed(0)", "3"],
    ["(-1.5).toFixed(1)", "-1.5"],
    ["(1).toFixed(100).length", 102],
    ["(1).toFixed(101)", null],
    ["(1).toFixed(-1)", null],
    ["(2.567).toFixed(1.5)", "2.6"],
    ["(1).toFixed(null)", null],
    ['(1).toFixed(["a"][0])', null],
    ["number(volume).toFixed(1)", "12.0"],
    ['number(volume).toFixed(1) == "12.0"', true],
    ["number(pages).toFixed(1)", null],
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

describe("list helpers", () => {
  vectors([
    // flat opens one level of nested lists.
    ["[1, [2, 3]].flat()", [1, 2, 3]],
    ["[1, [2, [3]]].flat()", [1, 2, [3]]],
    ["[[], [null]].flat()", [null]],
    ["tags.flat()", ["methods", "to-read", "To-Read"]],
    ["[].flat()", []],
    // A null subject gives null.
    ["null.flat()", null],
    ["if(attachments, null, tags).flat()", null],
    // join writes each element as toString() does, and null as empty text.
    ['tags.join("; ")', "methods; to-read; To-Read"],
    [
      'creators.join(", ")',
      "Ada Lovelace, World Health Organization, Ada Lovelace",
    ],
    ['[1, null, "a", true].join("-")', "1--a-true"],
    ['[null, null].join(",")', ","],
    ['[[1, 2], 3].join("|")', "1, 2|3"],
    ['[today(), duration("P1D")].join(" ")', "2024-07-15 P1D"],
    ['[].join(",")', ""],
    ['tags.join("")', "methodsto-readTo-Read"],
    ["tags.join(publisher)", null],
    ['null.join(",")', null],
    // reverse and slice give a new list; the subject stays as it is.
    ["tags.reverse()", ["To-Read", "to-read", "methods"]],
    ["[1, [2, 3], null].reverse()", [null, [2, 3], 1]],
    ["[].reverse()", []],
    ["tags.reverse() == tags", false],
    ["tags.reverse().reverse() == tags", true],
    ["null.reverse()", null],
    // slice follows the index rules of JavaScript, negative indexes included.
    ["tags.slice(0, 2)", ["methods", "to-read"]],
    ["tags.slice(1)", ["to-read", "To-Read"]],
    ["tags.slice(-1)", ["To-Read"]],
    ["tags.slice(-2, -1)", ["to-read"]],
    ["tags.slice(0, -1)", ["methods", "to-read"]],
    ["tags.slice(2, 1)", []],
    ["tags.slice(5)", []],
    ["tags.slice(0, 99)", ["methods", "to-read", "To-Read"]],
    ["tags.slice(0, 0)", []],
    ["tags.slice(1.5)", ["to-read", "To-Read"]],
    ["[].slice(0)", []],
    ["tags.slice(0, 2).length", 2],
    ["tags.slice(null)", null],
    ["tags.slice(0, null)", null],
    ["null.slice(0)", null],
    // unique keeps the first of the elements that == makes equal.
    ['["b", "a", "b", "a"].unique()', ["b", "a"]],
    ["creators.unique()", ["Ada Lovelace", "World Health Organization"]],
    // Exact equality: case counts, and no coercion between types.
    ['["a", "A"].unique()', ["a", "A"]],
    ['[1, "1", true].unique()', [1, "1", true]],
    ["[null, null, 1].unique()", [null, 1]],
    [
      "[[1, 2], [1, 2], [2, 1]].unique()",
      [
        [1, 2],
        [2, 1],
      ],
    ],
    // Two dates are equal when they share a calendar day; the first stays.
    [
      '[date("2020-01-15 10:30"), date("2020-01-15"), date("2020")].unique().toString()',
      "2020-01-15T10:30:00Z",
    ],
    ['[date("2020-01-15"), date("2020-01-16")].unique().length', 2],
    ['[duration("1d"), duration("24h"), duration("P1D")].unique().length', 2],
    ["[].unique()", []],
    ["null.unique()", null],
    // sort: numbers by value, texts in the Item Query string order, dates by
    // their start, booleans false first.
    ["[3, 1, 2].sort()", [1, 2, 3]],
    ["[1.5, -2, 0].sort()", [-2, 0, 1.5]],
    ['["b", "a", "c"].sort()', ["a", "b", "c"]],
    // Digits compare digit by digit, so 10 comes before 9.
    [
      '["9", "10", "Zebra", "Éclair", "eclair"].sort()',
      ["10", "9", "eclair", "Éclair", "Zebra"],
    ],
    ["tags.reverse().sort()", ["methods", "to-read", "To-Read"]],
    ["[true, false, true].sort()", [false, true, true]],
    [
      '[date("2020-06"), date("2020-01-15 10:30"), date("2020"), date("2020-01-15")].sort().toString()',
      "2020, 2020-01-15, 2020-01-15T10:30:00Z, 2020-06",
    ],
    // Elements of different types group in the order boolean, number, text,
    // date, duration, list; null comes last.
    [
      '[null, [1], duration("1d"), today(), "a", 2, true].sort().toString()',
      "true, 2, a, 2024-07-15, P1D, 1, null",
    ],
    ['[null, "b", null, "a"].sort()', ["a", "b", null, null]],
    ['[2, "1", 1, "2"].sort()', [1, 2, "1", "2"]],
    // Stable: equal elements, durations, and lists keep their order.
    ['[duration("2d"), duration("1d")].sort().toString()', "P2D, P1D"],
    ["[[2], [1]].sort()", [[2], [1]]],
    [
      '[date("2020-01-15"), date("2020-01-15 00:00")].sort().toString()',
      "2020-01-15, 2020-01-15T00:00:00Z",
    ],
    // Dates sort by their start at full precision.
    [
      '[date("2020-01-15 10:30:00.0000002Z"), date("2020-01-15 10:30:00.0000001Z")].sort().toString()',
      "2020-01-15T10:30:00.0000001Z, 2020-01-15T10:30:00.0000002Z",
    ],
    ["[].sort()", []],
    ["tags.sort() == tags", true],
    ["null.sort()", null],
  ]);
});

describe("element expressions", () => {
  vectors([
    // filter keeps the elements for which the expression is truthy.
    ['tags.filter(value.contains("read"))', ["to-read"]],
    ['tags.filter(value.lower() == "to-read")', ["to-read", "To-Read"]],
    ['creators.filter(value.contains("Lovelace")).length', 2],
    ["creators.filter(index == 0)", ["Ada Lovelace"]],
    ["[1, 2, 3].filter(value > 1)", [2, 3]],
    ["tags.filter(true)", ["methods", "to-read", "To-Read"]],
    ["tags.filter(null)", []],
    // map collects the value of the expression for each element.
    ["tags.map(value.lower())", ["methods", "to-read", "to-read"]],
    ["tags.map(index)", [0, 1, 2]],
    ["[1, 2].map(value * 2)", [2, 4]],
    ["[1, null].map(value.isEmpty())", [false, true]],
    // A built-in field keeps its meaning inside the expression.
    ["[1, 2].map(title)", ["Ecology of Éclairs", "Ecology of Éclairs"]],
    // reduce folds the list: acc starts at initial.
    ["tags.reduce(acc + value.length, 0)", 21],
    ["[1, 2, 3].reduce(acc + value, 0)", 6],
    ["[1, 2, 3].reduce(acc * value, 1)", 6],
    ['tags.reduce(acc + ", " + value, "")', ", methods, to-read, To-Read"],
    ["[1, 2].reduce(index, null)", 1],
    // A null initial: null adds no text and gives null in arithmetic.
    ["tags.reduce(acc + value, null)", "methodsto-readTo-Read"],
    ["[1, 2].reduce(acc + value, null)", null],
    ["[].reduce(acc, null)", null],
    // An empty list gives an empty list, or initial.
    ["[].filter(value)", []],
    ["[].map(value)", []],
    ["[].reduce(acc + value, 0)", 0],
    // A null or non-list subject gives null.
    ["tags[9].filter(value)", null],
    ["if(false, tags).map(value)", null],
    ["tags[9].reduce(acc, 0)", null],
    ["tags[0].filter(value)", null],
    ["tags[0].map(value)", null],
    ["tags[0].reduce(acc, 0)", null],
    // A nested element expression binds the innermost names; the outer
    // names stay bound.
    ["[[1, 2], [3]].map(value.map(value * 10))", [[10, 20], [30]]],
    ['[["a"], ["b", "c"]].map(value.filter(index == 0))', [["a"], ["b"]]],
    ["[[1, 2], [3]].reduce(acc + value.filter(value > acc).length, 0)", 3],
    ["[1, 2].reduce(acc + [10, 20].reduce(acc + value, 0), 0)", 60],
    ["[[1], [2, 3]].map(index + value.length)", [1, 3]],
  ]);

  it("binds value, index, and acc only inside the expression", () => {
    const named = item({
      custom: { value: "field", index: "5", acc: "sum" },
      tags: ["a", "b"],
    });
    expect(valueOf("value", named)).toBe("field");
    expect(valueOf("index", named)).toBe("5");
    expect(valueOf("acc", named)).toBe("sum");
    expect(valueOf("tags.map(value)", named)).toEqual(["a", "b"]);
    expect(valueOf("tags.map(index)", named)).toEqual([0, 1]);
    expect(valueOf('tags.map(custom["value"])', named)).toEqual([
      "field",
      "field",
    ]);
    expect(valueOf("tags.reduce(acc + value, index)", named)).toBe("5ab");
    // acc is bound in reduce alone.
    expect(valueOf("tags.map(acc)", named)).toEqual(["sum", "sum"]);
    expect(valueOf("tags.filter(acc)", named)).toEqual(["a", "b"]);
    expect(valueOf("tags.map(acc)")).toEqual([null, null, null]);
    expect(plan("tags.filter(acc)").customFields).toMatchObject([
      { name: "acc", bare: true },
    ]);
    expect(plan("tags.reduce(acc, value)").customFields).toMatchObject([
      { name: "value", bare: true },
    ]);
    expect(plan("tags.reduce(acc + value + index, 0)").customFields).toEqual(
      [],
    );
  });
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

// The vectors assert primitive values: a date is read through its text, its
// parts, or a comparison.
describe("now() and today()", () => {
  vectors([
    ["now().toString()", "2024-07-15T12:00:00Z"],
    ["now().timestamp", 1_721_044_800_000],
    ["today().toString()", "2024-07-15"],
    ["today().hour", 0],
    // Every call sees the same instant.
    ["now() == now()", true],
    ["today() == now().date()", true],
    ["now() >= today()", true],
    ["now() > today()", false],
    ['now().isType("date")', true],
    ['duration("1d").isType("duration")', true],
    ["today().isEmpty()", false],
  ]);
});

describe("date()", () => {
  vectors([
    ['date("2020-01-15").year', 2020],
    ['date("2020-01-15").month', 1],
    ['date("2020-01-15").day', 15],
    ['date("2020-03").day', null],
    ['date("2020").month', null],
    ['date("2020").year', 2020],
    ['date("2020-01-15").hour', 0],
    ['date("2020-01-15 10:30").hour', 10],
    ['date("2020-01-15T10:30:00Z").timestamp', 1_579_084_200_000],
    ['date("2020-01-15T10:30:00.123Z").millisecond', 123],
    // An explicit offset fixes the instant.
    ['date("2020-01-15 10:30+02:00").hour', 8],
    ['date("20200115") == date("2020-01-15")', true],
    ['date("202001151030").hour', 10],
    ['date("2024-02-29").day', 29],
    // Unparseable text and impossible dates are null.
    ['date("banana")', null],
    ['date("2020-13-01")', null],
    ['date("2021-02-29")', null],
    ['date("2020-01-15 25:00")', null],
    ["date(publisher)", null],
    ["date(null)", null],
  ]);
});

describe("duration()", () => {
  vectors([
    ['duration("P1Y") == duration("1 year")', true],
    ['duration("-2 weeks") == duration("-P2W")', true],
    // Weeks fold into days.
    ['duration("2 weeks") == duration("14 days")', true],
    ['duration("P2W") == duration("14 days")', true],
    ['duration("90m") == duration("PT90M")', true],
    // `M` is months, `m` minutes.
    ['duration("1M") == duration("1 month")', true],
    ['duration("1M") == duration("1m")', false],
    ['duration("nonsense")', null],
    ["duration(publisher)", null],
    // A zero duration is falsy.
    ['duration("1 day") && true', true],
    ['duration("0 days") || false', false],
  ]);
});

describe("date text", () => {
  vectors([
    ['date("2020-01-15").toString()', "2020-01-15"],
    ['date("2020-03").toString()', "2020-03"],
    ['date("2020").toString()', "2020"],
    ['date("2020-01-15 10:30").toString()', "2020-01-15T10:30:00Z"],
    ['"P: " + duration("1 year")', "P: P1Y"],
    ['"on " + today()', "on 2024-07-15"],
    ['[today(), duration("P1D")].toString()', "2024-07-15, P1D"],
  ]);
});

describe("date comparison", () => {
  vectors([
    // A partial date is the interval of days it covers.
    ['date("2020") == date("2020-06-15")', true],
    ['date("2020") != date("2021-01-01")', true],
    ['date("2020") > date("2019-12-31")', true],
    ['date("2020") > date("2020-01-01")', false],
    ['date("2020") >= date("2020-12-31")', true],
    ['date("2020") <= date("2020-01-01")', true],
    ['date("2020") < date("2020-06-01")', false],
    ['date("2020") < date("2021")', true],
    ['date("2020-05") < date("2020-06")', true],
    ['date("2020-05") <= date("2020-05-31")', true],
    // Month ends, a leap day, and the year end.
    ['date("2020-02") == date("2020-02-29")', true],
    ['date("2021-02") == date("2021-02-28")', true],
    ['date("2021-02") < date("2021-03-01")', true],
    ['date("2020-12-31") < date("2021")', true],
    ['date("2020") < date("2021-01-01")', true],
    // Two timestamps compare as instants.
    ['date("2020-01-15 10:30") < date("2020-01-15 10:31")', true],
    ['date("2020-01-15 10:30") == date("2020-01-15 10:31")', false],
    ['date("2020-01-15 10:30:00.5") > date("2020-01-15 10:30")', true],
    // A timestamp and a calendar date compare by calendar day, in both orders.
    ['date("2020-01-15 10:30") == date("2020-01-15")', true],
    ['date("2020-01-15") == date("2020-01-15 10:30")', true],
    ['date("2020-01-15") < date("2020-01-15 23:59")', false],
    ['date("2020-01-15") <= date("2020-01-15 23:59")', true],
    ['date("2020") >= date("2020-12-31 23:59")', true],
    // An offset that crosses the UTC day boundary.
    ['date("2020-01-15T23:30:00-05:00") == date("2020-01-16")', true],
    // No coercion between types.
    ['date("2020") == "2020"', false],
    ['date("2020") > "2019"', null],
    ['date("2020") > 5', null],
    ['duration("1d") > duration("2d")', null],
    ['duration("1d") == "P1D"', false],
    ["publisher < today()", null],
    ['[date("2020")].contains(date("2020-06-15"))', true],
  ]);
});

describe("date arithmetic", () => {
  vectors([
    ['(date("2020-01-15") + duration("1 month")).toString()', "2020-02-15"],
    ['(duration("1 year") + date("2020-01-15")).toString()', "2021-01-15"],
    // The calendar clamps a day past the end of the month.
    ['(date("2020-01-31") + duration("1M")).toString()', "2020-02-29"],
    // A partial date keeps its precision.
    ['(date("2020") + duration("1M")).toString()', "2020"],
    ['(date("2020-01") - duration("1M")).toString()', "2019-12"],
    // A partial date is the whole year or month that holds the day the
    // arithmetic gives.
    ['(date("2020") + duration("1M")) == date("2020-01-15")', true],
    ['(date("2020") + duration("1M")) == date("2020-12-31")', true],
    ['(date("2020") + duration("1M")) < date("2021-01-01")', true],
    ['(date("2020") + duration("1M")) == date("2021-01-15")', false],
    ['(date("2020") + duration("12M")) == date("2021-01-15")', true],
    ['(date("2020-03") + duration("10d")) == date("2020-03-05")', true],
    ['(date("2020-03") + duration("10d")) == date("2020-04-05")', false],
    ['(date("2020-03") + duration("31d")) == date("2020-04-30")', true],
    // A time of day gives a timestamp from the start of the first day.
    [
      '(date("2020-01-15") - duration("12h")).toString()',
      "2020-01-14T12:00:00Z",
    ],
    ['(now() - duration("1d")).toString()', "2024-07-14T12:00:00Z"],
    ['now() - duration("7 days") < now()', true],
    // Other combinations give null.
    ['date("2020-01-15") - date("2020-01-14")', null],
    ["now() + 1", null],
    ['duration("1d") + duration("1d")', null],
    ['duration("1d") - now()', null],
    ['publisher + duration("1d")', null],
  ]);
});

describe("date methods and properties", () => {
  vectors([
    ['date("2020-01-15 10:30").date().toString()', "2020-01-15"],
    ['date("2020").date().toString()', "2020"],
    ['date("2020-01-15 10:30:45").time()', "10:30:45"],
    ['date("2020-01-15").time()', "00:00:00"],
    [
      'date("2020-01-15 10:30").format("YYYY/MM/DD HH:mm:ss")',
      "2020/01/15 10:30:00",
    ],
    ['date("2020-03").format("YYYY-MM-DD")', "2020-03-01"],
    ['date("2020-01-15").format(publisher)', null],
    ["now().relative()", "just now"],
    ['(now() - duration("3 days")).relative()', "3 days ago"],
    ['(now() + duration("2h")).relative()', "in 2 hours"],
    ["today().relative()", "today"],
    ['(today() - duration("1d")).relative()', "1 day ago"],
    ['date("2020-03-01").relative()', "4 years ago"],
    ['date("2020-03").year', 2020],
    ['date("2020-03").month', 3],
  ]);
});

describe("date fields", () => {
  const dated = (fields: Record<string, string>) =>
    item({ fields, dateAdded: "2020-01-07T06:00:00Z" });

  it.each([
    ["2020-03-15 2020-03-15", "date.toString()", "2020-03-15"],
    ["2019-11-00 November 2019", "date.toString()", "2019-11"],
    ["2019-11-00 November 2019", 'date == date("2019-11-30")', true],
    ["2018-00-00 2018", 'date > date("2017-12-31")', true],
    // A text date takes the year the date parser finds in it.
    ["0000-00-00 circa 1850", "date.toString()", "1850"],
    ["0000-00-00 circa 1850", 'date == date("1850-06")', true],
    ["0000-00-00 1990-1991", "date.year", 1990],
    // A text date without a year in 1000-2999 is null.
    ["0000-00-00 forthcoming", "date", null],
    ["0000-00-00 0999", "date", null],
    ["0000-00-00 3000", "date", null],
    // An impossible day falls back to the month.
    ["2021-02-30 2021-02-30", "date.toString()", "2021-02"],
  ])("reads the date %j: %s gives %j", (stored, expression, expected) => {
    expect(valueOf(expression, dated({ date: stored }))).toEqual(expected);
  });

  it("reads filingDate and the type-specific fields of date as calendar dates", () => {
    expect(
      valueOf(
        "filingDate.toString()",
        dated({ filingDate: "2021-06-00 June 2021" }),
      ),
    ).toBe("2021-06");
    expect(
      valueOf("issueDate.year", dated({ issueDate: "2020-05-04 2020-05-04" })),
    ).toBe(2020);
  });

  it("reads dateAdded and dateModified as timestamps", () => {
    const of = dated({});

    expect(valueOf("dateAdded.toString()", of)).toBe("2020-01-07T06:00:00Z");
    expect(valueOf("dateModified.toString()", of)).toBe("2020-01-01T00:00:00Z");
    expect(valueOf("dateAdded > dateModified", of)).toBe(true);
  });

  it.each([
    // Zotero stores a UTC timestamp.
    ["2020-01-07 04:00:00", "accessDate.toString()", "2020-01-07T04:00:00Z"],
    ["2020-01-07 04:00:00", "accessDate < dateAdded", true],
    ["2020-01-07", "accessDate.toString()", "2020-01-07"],
    ["2020-01-07", "accessDate == dateAdded", true],
    ["yesterday", "accessDate", null],
    ["2021-02-30 10:00:00", "accessDate", null],
    ["2020-01-07 04:00:60", "accessDate", null],
  ])("reads the accessDate %j: %s gives %j", (stored, expression, expected) => {
    expect(valueOf(expression, dated({ accessDate: stored }))).toEqual(
      expected,
    );
  });
});

describe("the query time zone", () => {
  // 02:00Z on 8 January is 21:00 on 7 January in New York.
  const NEW_YORK: QueryClock = {
    now: Temporal.Instant.from("2020-01-08T02:00:00Z"),
    timeZone: "America/New_York",
  };
  const inNewYork = (expression: string, of: QueryItem = ARTICLE) =>
    valueOf(expression, of, NEW_YORK);

  it("defines today() and .date() on a timestamp", () => {
    expect(inNewYork("today().toString()")).toBe("2020-01-07");
    expect(inNewYork("now().date().toString()")).toBe("2020-01-07");
    expect(inNewYork("today() == now().date()")).toBe(true);
    expect(
      valueOf("today().toString()", ARTICLE, { ...NEW_YORK, timeZone: "UTC" }),
    ).toBe("2020-01-08");
  });

  it("compares a timestamp with a calendar day on the day of the zone", () => {
    const at = (instant: string) => item({ dateAdded: instant });

    expect(inNewYork("dateAdded >= today()", at("2020-01-07T06:00:00Z"))).toBe(
      true,
    );
    expect(inNewYork("dateAdded >= today()", at("2020-01-07T04:00:00Z"))).toBe(
      false,
    );
    expect(
      inNewYork('dateAdded == date("2020-01-06")', at("2020-01-07T04:00:00Z")),
    ).toBe(true);
  });

  it("gives the parts, the time, and the format of a timestamp in the zone", () => {
    expect(inNewYork("now().day")).toBe(7);
    expect(inNewYork("now().hour")).toBe(21);
    expect(inNewYork("now().time()")).toBe("21:00:00");
    expect(inNewYork('now().format("YYYY-MM-DD HH:mm")')).toBe(
      "2020-01-07 21:00",
    );
    // The timestamp of a calendar date is the start of its first day.
    expect(inNewYork('date("2020-01-08").timestamp')).toBe(1_578_459_600_000);
  });

  it("reads a time without an offset as a wall-clock time in the zone", () => {
    expect(inNewYork('date("2020-01-07 23:00").timestamp')).toBe(
      1_578_456_000_000,
    );
    expect(inNewYork('date("2020-01-07 23:00") == today()')).toBe(true);
  });

  it("counts relative() calendar days from today in the zone", () => {
    expect(inNewYork('date("2020-01-07").relative()')).toBe("today");
    expect(inNewYork('date("2020-01-08").relative()')).toBe("in 1 day");
    expect(
      valueOf('date("2020-01-08").relative()', ARTICLE, {
        ...NEW_YORK,
        timeZone: "UTC",
      }),
    ).toBe("today");
  });

  it("adds calendar days by the wall clock of the zone, across a change of offset", () => {
    // New York moves to daylight saving time on 8 March 2020.
    expect(inNewYork('(date("2020-03-08 00:00") + duration("1d")).hour')).toBe(
      0,
    );
    expect(inNewYork('(date("2020-03-08 00:00") + duration("24h")).hour')).toBe(
      1,
    );
    expect(inNewYork('(date("2020-01-07") + duration("1h")).toString()')).toBe(
      "2020-01-07T06:00:00Z",
    );
  });
});

describe("validation", () => {
  it.each([
    ["", "invalid-filter", [0, 0]],
    ["   ", "invalid-filter", [3, 3]],
    ['title == "a', "invalid-filter", [11, 11]],
    ["title ==", "invalid-filter", [8, 8]],
    ["title.contains(/ab/)", "wrong-argument-type", [15, 19]],
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
    // A list helper on a subject of a definite non-list type.
    ["title.sort()", "unknown-function", [6, 10]],
    ['title.join(",")', "unknown-function", [6, 10]],
    ["title.flat()", "unknown-function", [6, 10]],
    ["attachments.unique()", "unknown-function", [12, 18]],
    ["attachments.reverse()", "unknown-function", [12, 19]],
    ["(1).slice(0)", "unknown-function", [4, 9]],
    ["dateAdded.flat()", "unknown-function", [10, 14]],
    ["tags.join()", "wrong-argument-count", [0, 11]],
    ["tags.join(1)", "wrong-argument-type", [10, 11]],
    ["tags.slice()", "wrong-argument-count", [0, 12]],
    ["tags.slice(0, 1, 2)", "wrong-argument-count", [0, 19]],
    ['tags.slice("0")', "wrong-argument-type", [11, 14]],
    ["tags.slice(0, tags)", "wrong-argument-type", [14, 18]],
    ["tags.sort(1)", "wrong-argument-count", [0, 12]],
    ["tags.unique(1)", "wrong-argument-count", [0, 14]],
    ["tags.flat(1)", "wrong-argument-count", [0, 12]],
    ["tags.reverse(1)", "wrong-argument-count", [0, 15]],
    // An element expression is validated like every other part, also on an
    // empty list; value and acc have no known type, index is a number.
    ["tags.filter(noSuchFunction(value))", "unknown-function", [12, 26]],
    ["[].map(value.noSuchMethod())", "unknown-function", [13, 25]],
    ["[].reduce(acc.lenght, 0)", "unknown-property", [14, 20]],
    ["tags.filter(index.lower())", "unknown-function", [18, 23]],
    ["tags.filter(value.startsWith(index))", "wrong-argument-type", [29, 34]],
    ["tags.map(value.contains())", "wrong-argument-count", [9, 25]],
    ["tags.filter()", "wrong-argument-count", [0, 13]],
    ["tags.map(value, 1)", "wrong-argument-count", [0, 18]],
    ["tags.reduce(acc)", "wrong-argument-count", [0, 16]],
    ["tags.reduce(acc, 0, 1)", "wrong-argument-count", [0, 22]],
    // An element method on a subject of a definite non-list type.
    ["title.filter(value)", "unknown-function", [6, 12]],
    ["(1).map(value)", "unknown-function", [4, 7]],
    ["attachments.reduce(acc, 0)", "unknown-function", [12, 18]],
    ["dateAdded.map(value)", "unknown-function", [10, 13]],
    // The names are bound inside the expression alone.
    ["value.filter(value)", "unknown-function", [6, 12]],
    // A global function called as a method, and a method called as a global.
    ["title.number()", "unknown-function", [6, 12]],
    ['contains(title, "a")', "unknown-function", [0, 8]],
    ["title.startsWith()", "wrong-argument-count", [0, 18]],
    ['title.startsWith("a", "b")', "wrong-argument-count", [0, 26]],
    ["title.lower(1)", "wrong-argument-count", [0, 14]],
    ["number()", "wrong-argument-count", [0, 8]],
    ["number(1, 2)", "wrong-argument-count", [0, 12]],
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
    ['title.isType("strng")', "wrong-argument-type", [13, 20]],
    ["collections.within(1)", "wrong-argument-type", [19, 20]],
    // The type of the argument is known from the field it reads.
    ["title.startsWith(tags)", "wrong-argument-type", [17, 21]],
    ["tags[0].startsWith(1)", "wrong-argument-type", [19, 20]],
    ["title.lenght", "unknown-property", [6, 12]],
    ["title.Length", "unknown-property", [6, 12]],
    ["attachments.length", "unknown-property", [12, 18]],
    ["(1).length", "unknown-property", [4, 10]],
    // Date functions, methods, and properties.
    ["date(5)", "wrong-argument-type", [5, 6]],
    ["date(tags)", "wrong-argument-type", [5, 9]],
    ['duration(["1d"])', "wrong-argument-type", [9, 15]],
    ["now(1)", "wrong-argument-count", [0, 6]],
    ['today("UTC")', "wrong-argument-count", [0, 12]],
    ["date()", "wrong-argument-count", [0, 6]],
    ["dateAdded.format()", "wrong-argument-count", [0, 18]],
    ["dateAdded.format(1)", "wrong-argument-type", [17, 18]],
    ["dateAdded.relative(1)", "wrong-argument-count", [0, 21]],
    ["dateAdded.lower()", "unknown-function", [10, 15]],
    ["title.relative()", "unknown-function", [6, 14]],
    ['duration("1d").date()', "unknown-function", [15, 19]],
    ["date.length", "unknown-property", [5, 11]],
    ["title.year", "unknown-property", [6, 10]],
    ['duration("1d").days', "unknown-property", [15, 19]],
    ['(now() - duration("1d")).length', "unknown-property", [25, 31]],
    // Text, number, and wrapping helpers.
    ["tags.trim()", "unknown-function", [5, 9]],
    ["(1).title()", "unknown-function", [4, 9]],
    ["attachments.repeat(2)", "unknown-function", [12, 18]],
    ["dateAdded.reverse()", "unknown-function", [10, 17]],
    ["dateAdded.slice(0)", "unknown-function", [10, 15]],
    ['tags.replace("a", "b")', "unknown-function", [5, 12]],
    ['tags.split(":")', "unknown-function", [5, 10]],
    ["title.toFixed(1)", "unknown-function", [6, 13]],
    ["title.trim(1)", "wrong-argument-count", [0, 13]],
    ["title.title(1)", "wrong-argument-count", [0, 14]],
    ["title.repeat()", "wrong-argument-count", [0, 14]],
    ['title.repeat("2")', "wrong-argument-type", [13, 16]],
    ["title.reverse(1)", "wrong-argument-count", [0, 16]],
    ["title.slice()", "wrong-argument-count", [0, 13]],
    ["title.slice(0, 1, 2)", "wrong-argument-count", [0, 20]],
    ['title.slice("0")', "wrong-argument-type", [12, 15]],
    ['title.slice(0, "1")', "wrong-argument-type", [15, 18]],
    ['title.replace("a")', "wrong-argument-count", [0, 18]],
    ['title.replace(1, "a")', "wrong-argument-type", [14, 15]],
    ['title.replace("a", 1)', "wrong-argument-type", [19, 20]],
    ["title.split()", "wrong-argument-count", [0, 13]],
    ["title.split(1)", "wrong-argument-type", [12, 13]],
    ['title.split(":", "2")', "wrong-argument-type", [17, 20]],
    ["(1).toFixed()", "wrong-argument-count", [0, 13]],
    ['(1).toFixed("1")', "wrong-argument-type", [12, 15]],
    ["title.isTruthy(1)", "wrong-argument-count", [0, 17]],
    ["list()", "wrong-argument-count", [0, 6]],
    ["list(1, 2)", "wrong-argument-count", [0, 10]],
    ["title.list()", "unknown-function", [6, 10]],
    // Regular expressions: a pattern or flag the engine rejects fails at the
    // literal; a regexp where a text is required is a wrong argument type.
    ["/(/.matches(title)", "invalid-filter", [0, 3]],
    ["title == /[/", "invalid-filter", [9, 12]],
    ["/a/gg.matches(title)", "invalid-filter", [0, 5]],
    // A letter outside the flags of the grammar is a syntax error at the letter.
    ["/a/x.matches(title)", "invalid-filter", [3, 4]],
    ["/a/uv.matches(title)", "invalid-filter", [0, 5]],
    ["/\\p{Letter/u.matches(title)", "invalid-filter", [0, 12]],
    ["title.startsWith(/a/)", "wrong-argument-type", [17, 20]],
    ["title.endsWith(/a/)", "wrong-argument-type", [15, 18]],
    ['title.containsAny("a", /b/)', "wrong-argument-type", [23, 26]],
    ["tags.join(/a/)", "wrong-argument-type", [10, 13]],
    ["/a/.matches(1)", "wrong-argument-type", [12, 13]],
    ["/a/.matches(tags)", "wrong-argument-type", [12, 16]],
    ["/a/.matches(/b/)", "wrong-argument-type", [12, 15]],
    ["/a/.matches()", "wrong-argument-count", [0, 13]],
    ['/a/.matches("a", "b")', "wrong-argument-count", [0, 21]],
    ["title.matches(/a/)", "unknown-function", [6, 13]],
    ["tags.matches(/a/)", "unknown-function", [5, 12]],
    ["/a/.isEmpty()", "unknown-function", [4, 11]],
    ["/a/.lower()", "unknown-function", [4, 9]],
    ["/a/.sort()", "unknown-function", [4, 8]],
    ["/a/.length", "unknown-property", [4, 10]],
    ["title.replace(/a/)", "wrong-argument-count", [0, 18]],
    ["title.replace(/a/, /b/)", "wrong-argument-type", [19, 22]],
    ['title.split(/a/, "2")', "wrong-argument-type", [17, 20]],
    ["list == 1", "unknown-field", [0, 4]],
    ["custom", "unfilterable-field", [0, 6]],
    ["custom.isEmpty()", "unfilterable-field", [0, 6]],
    ["min == 1", "unknown-field", [0, 3]],
    ['if == "a"', "unknown-field", [0, 2]],
  ] as const)("rejects %j with %s at %j", (expression, code, [from, to]) => {
    const fault = problem(expression);
    if (fault.kind === "syntax") {
      expect(fault.fault).toMatchObject({ from, to });
      return;
    }
    expect(fault).toMatchObject({
      kind: "plain",
      code,
      at: { from, to },
    });
  });

  // A branch that never runs is validated like every other part.
  it.each([
    ["false && noSuchFunction()", "unknown-function"],
    ["true || title.startsWith(1)", "wrong-argument-type"],
    ["if(true, 1, title.startsWith())", "wrong-argument-count"],
    ["if(false, title.lenght, 1)", "unknown-property"],
    ["if(true, 1, custom)", "unfilterable-field"],
    ["if(true, now(), date(1))", "wrong-argument-type"],
    ['if(false, title.isType("strng"), true)', "wrong-argument-type"],
    ["true || title.contains(/a/)", "wrong-argument-type"],
    ["[1, noSuchFunction()].length", "unknown-function"],
  ] as const)("rejects the dead branch of %j with %s", (expression, code) => {
    const fault = problem(expression);
    expect(fault.kind === "syntax" ? "invalid-filter" : fault.code).toBe(code);
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
    "null.isTruthy()",
    // A regexp where a text or a regexp pattern is taken, and a subject
    // whose type depends on the Item.
    "/a/.matches(tags[0])",
    "/a/.matches(publisher)",
    'title.replace(/a/, "b")',
    "title.split(/a/, 2)",
    'tags[0].replace(/a/, "b")',
    "if(attachments, /a/, title).matches(title)",
    "/\\//.matches(title)",
    "/a/dgimsuy.matches(title)",
    "/a/v.matches(title)",
    "tags[0].trim()",
    'title.split(":")[0].trim()',
    'list(tags[0]).contains("a")',
    "list(publisher).isEmpty()",
    "min(number(volume), 3)",
    // A list helper on a subject whose type depends on the Item, and on the
    // list another list helper gives.
    "tags[0].sort()",
    'if(attachments, title, tags).join(",")',
    "tags.sort().unique().reverse().slice(0, 1).flat().length",
    // A date before and after date arithmetic keeps its methods.
    '(now() - duration("1d")).format("YYYY")',
    '(duration("1d") + today()).relative()',
    "date.date().year",
    'date(title).format("YYYY")',
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
    ["list", false],
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
