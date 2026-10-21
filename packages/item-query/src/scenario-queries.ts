// The query list of the scenario: the one place the parity suite reads. Every
// query runs on the scenario database (`@zotlit/db/test-scenario`) with each
// plan and chunk size, and each run must give the Query Result of the forced
// scan. Add an entry for each new scenario query, leaf, or function.
import type { ScenarioLibraryName } from "@zotlit/db/test-scenario";

import type { ItemQueryRequest, SortSpec } from "./request";

export interface ScenarioQuery {
  /** A unique name; it names the test. */
  readonly name: string;
  /** The Target Libraries of the request. */
  readonly libraries: readonly ScenarioLibraryName[];
  readonly request: Omit<ItemQueryRequest, "libraries">;
  /** The instant of the Query Clock, as an ISO string. Omitted: the test default. */
  readonly now?: string;
  /** The zone of the Query Clock. Omitted: the test default. */
  readonly timeZone?: string;
  /**
   * The Indexed Keys of the Items the query returns, in any order, worked out
   * from the scenario seed. Omitted: the forced scan is the only oracle.
   */
  readonly matches?: readonly string[];
}

/**
 * The Formulas of the scenario: a scenario filter that reads `formula.<name>`
 * runs with all of them. `decade` reads `year`, so a filter that reads it
 * reads a Formula through another Formula.
 */
const SCENARIO_FORMULAS: Readonly<Record<string, string>> = {
  year: "date.year",
  decade: "formula.year - formula.year % 10",
  tagged: 'tags.contains("to-read")',
  lovelace: 'creators.filter(value.contains("Lovelace")).length > 0',
  status: 'custom["review.status"]',
  // An Error Value on each Item whose title is not a number.
  volumes: "number(title)",
};

/** The Formulas of a scenario request: all of them when the filter reads one. */
export function scenarioFormulas(
  filter: string,
): Pick<ItemQueryRequest, "formulas"> {
  return filter.includes("formula") ? { formulas: SCENARIO_FORMULAS } : {};
}

/**
 * The Filter Expressions of the scenario. Each one runs in each Library and
 * in both Libraries together as an unlimited identity-only query in key order,
 * and in the personal Library and in both Libraries together as a limited,
 * sorted query with a projection.
 */
const FILTERS: readonly string[] = [
  'indexedKey == "ART2FULL"',
  '"ART2FULLg4815" == indexedKey',
  '["ART2FULL", "ART2FULLg4815"].contains(indexedKey)',
  '["ART2FULL", "bad"].contains(indexedKey)',
  '["ART2FULL", key].contains(indexedKey)',
  'indexedKey == "bad"',
  'indexedKey == "ART2FULLg999" || key == "ART2FULL"',
  'indexedKey == "ART2FULL" && tags.contains("methods")',
  '!(indexedKey == "ART2FULL")',
  "[].contains(indexedKey)",

  'library == "personal"',
  'library != "personal"',
  'library == "group:4815"',
  'library == "group:4815" && key == "ART2FULL"',
  'review.status == "include"',
  'custom.review.status == "include"',
  'custom["reviewStatus"] == "include"',
  'mood2 == "include"',
  'review.status.more == "include"',
  'custom.review.status.more == "include"',
  'tags == "bulk" && review.status == "include"',
  'mood.length > 0 && custom["review.status"].length > 0',
  'tags == "bulk"',
  'tags != "bulk"',
  'date.year == "2019"',
  'dateAdded > "2020-01-01"',
  'number("bad") == date("bad")',
  "true",
  "false",
  'itemType == "book"',
  'itemType == "book" && key != "ART2FULL"',
  // Tags: lowered leaves, exact names, Unicode and SQL wildcard hazards.
  'tags.contains("to-read")',
  'tags.contains("To-Read")',
  'tags.contains("TO-READ")',
  'tags.contains("tie")',
  'tags.contains("methods")',
  'tags.contains("group-only")',
  'tags.contains("Éclair")',
  'tags.contains("Éclair")',
  'tags.contains("eclair")',
  'tags.contains("100%_raw\\\\path")',
  'tags.contains("100__raw\\\\path")',
  'tags.contains("")',
  "tags.contains(null)",
  "tags.contains(12)",
  'tags.containsAny("tie", "methods")',
  'tags.containsAll("to-read", "methods")',
  "tags.isEmpty()",
  "tags.length > 1",
  'tags == ["tie"]',
  // Zotero Key: both Libraries hold ART2FULL; the others are a group Item, a
  // trashed Item, an Attachment, and no Item.
  'key == "ART2FULL"',
  '"ART2FULL" == key',
  'key == "GRP2BK22"',
  'key == "TRS2SHED"',
  'key == "PDF2LIVE"',
  'key == "NOSUCHKY"',
  'key == "art2full"',
  'key != "ART2FULL"',
  "key == null",
  'key.startsWith("TIE")',
  // Combinations of lowered leaves with `&&`, `||`, `!`, and other expressions.
  'tags.contains("to-read") && tags.contains("methods")',
  'tags.contains("to-read") && itemType == "book"',
  'title == "Same Title" && tags.contains("tie")',
  'tags.contains("tie") && key == "TIE2BBBB"',
  'tags.contains("tie") && key == "ART2FULL"',
  'tags.contains("tie") && !tags.contains("tie")',
  'tags.contains("tie") || tags.contains("methods")',
  'tags.contains("eclair") || key == "RPT2NDTE"',
  'tags.contains("eclair") || itemType == "report"',
  'key == "ART2FULL" || key == "BK2MNTH2" || key == "GRP2BK22"',
  'key == "ART2FULL" || key == "ART2FULL"',
  '(tags.contains("to-read") || tags.contains("tie")) && tags.contains("methods")',
  '(tags.contains("to-read") || title == "Lab Report") && key == "BK2MNTH2"',
  'tags.contains("to-read") && (key == "BK2MNTH2" || itemType == "journalArticle")',
  'tags.contains("tie") && title == null || key == "RPT2NDTE"',
  '!tags.contains("tie")',
  '!!tags.contains("tie")',
  '!(key == "ART2FULL")',
  'if(tags.contains("tie"), title == null, key == "ART2FULL")',
  'if(key == "ART2FULL", tags.contains("methods"))',
  'tags.contains("tie") == true',
  'tags.contains("tie") == (key == "TIE2AAAA")',
  'tags.contains("TIE".lower())',
  // Text, null, and the type matrix.
  'title.contains("Exact")',
  'title.lower().contains("exact")',
  'title.startsWith("Lab")',
  'title == "Same Title"',
  'title.contains("%_")',
  'title.contains("🧪")',
  'title.lower().contains("i̇stanbul")',
  "title == null",
  'title != "Same Title"',
  "!title",
  "title.isEmpty()",
  'volume == "12"',
  '"12" == volume',
  'volume == "12.0"',
  'volume == "012"',
  "volume == 12",
  "volume > 3",
  'volume >= "12"',
  'volume < "2"',
  '!(volume < "2")',
  "volume != null",
  "number(volume) > 3",
  // Text, number, and wrapping helpers: each with values that match no Item,
  // one Item, and several Items.
  "title.trim() == title",
  'title.trim() == "Lab Report"',
  'title.trim() == "  Lab Report  "',
  "title.title() == title",
  'title.title() == "Methods For Everyone"',
  'title.title() == "methods for everyone"',
  '"-".repeat(3) == "---"',
  'title.repeat(2) == "Same TitleSame Title"',
  'title.repeat(2) == "Lab ReportLab Report"',
  'title.repeat(0) == ""',
  "title.repeat(10001) == null",
  'title.repeat(-1) == ""',
  'title.reverse() == "tropeR baL"',
  'title.reverse().startsWith("eltiT")',
  "title.reverse() == title",
  'title.slice(0, 5) == "Group"',
  'title.slice(-6) == "Report"',
  'title.slice(0, 1) == "Z"',
  'title.replace(" ", "") == "SameTitle"',
  'title.replace("Lab", "Field") == "Field Report"',
  'title.replace("x", "x") == "nothing"',
  'title.split(" ")[0] == "Group"',
  'title.split(" ", 1)[0] == "Lab"',
  'title.split(" ").length > 4',
  'title.split(":").length > 1',
  'number(volume).toFixed(1) == "12.0"',
  'number(volume).toFixed(1) == "12.0" && key == "ART2FULL"',
  'number(volume).toFixed(2) == "12.00"',
  "number(volume).toFixed(101) == null",
  'number(volume).toFixed(0) == "13"',
  // Regular expressions: each with values that match no Item, one Item, and
  // several Items.
  "/^Same/.matches(title)",
  "/^lab report$/i.matches(title)",
  "/^zzz/.matches(title)",
  "/methods/i.matches(title)",
  "/exact matching/i.matches(title)",
  "/\\d/.matches(title)",
  "/é/.matches(title)",
  "/É/i.matches(title)",
  "/🧪/u.matches(title)",
  "/o/g.matches(title) && /o/g.matches(title)",
  "/^S/y.matches(title) && /^S/y.matches(title)",
  "/a/.matches(publisher)",
  "/\\d+/.matches(volume)",
  "!/e/.matches(title)",
  'title.replace(/\\s+/g, "") == "SameTitle"',
  'title.replace(/(\\w+) (\\w+)/, "$2 $1") == "Report Lab"',
  'title.replace(/x/, "y") == "nothing"',
  'title.replace(/[aeiou]/g, "").length < 8',
  'title.split(/\\s+/)[0] == "Group"',
  'title.split(/ /, 1)[0] == "Lab"',
  "title.split(/[:—]/).length > 1",
  "/a/ == /a/",
  "/a/ == /a/i",
  '/a/.toString() == "/a/"',
  "/a/ < /b/",
  '/a/.isType("regexp")',
  "publisher.isTruthy()",
  "!publisher.isTruthy()",
  "title.isTruthy()",
  'custom["review.status"].isTruthy()',
  'tags.isTruthy() && key == "RPT2NDTE"',
  "list(tags).length > 1",
  "list(publisher).isEmpty()",
  'list(title).contains("Lab Report")',
  'list(mood) == ["calm"]',
  'list(volume).contains("12")',
  "list(null).isEmpty()",
  // Names: base fields, aliases, and custom fields.
  'publicationTitle == "Handbook of Methods"',
  'publicationTitle == "Type-Specific Host"',
  'publicationTitle == "Custom Host"',
  'publicationTitle == "Base Field Host"',
  'publicationTitle == "Proceedings of Testing"',
  'proceedingsTitle == "Proceedings of Testing"',
  'institution == "Lab Institute"',
  'title == "Custom Title Value"',
  'title == "Trashed Article"',
  'title == "Full Text PDF"',
  'title == "Group Copy of Exact Matching"',
  'title == ""',
  'title == "Éclair İstanbul K 50%_off \\\\ é 🧪"',
  'title == "Éclair%"',
  'publisher == "Sage" || publisher == "Academic Press"',
  'publisher == "Sage" && collections.within("Thesis")',
  'bookTitle == "Handbook of Methods"',
  'publisher == "Lab Institute"',
  'publisher == "Sage" && custom["review.status"] == null',
  "proceedingsTitle != null",
  'custom["publicationTitle"] == "Custom Host"',
  'custom["review.status"] == "done"',
  'custom["review.status"].isEmpty()',
  'mood == "calm"',
  'custom.mood == "calm"',
  // Relation Lists, including the truth value of the Attachment list.
  "creators.length == 2",
  'creators == ["Grace Hopper", "Grace Hopper"]',
  'creators.contains("Grace Hopper")',
  'creators[0] == "Alan Turing"',
  "creators.isEmpty()",
  'itemType == "report" && creators.isEmpty()',
  'collections.contains("Thesis/Methods")',
  'collections.contains("Teaching/Methods")',
  'collections.contains("Methods")',
  'collections.contains("Thesis")',
  "collections.length == 2",
  'collections.within("Thesis")',
  'collections.within("Teaching")',
  'collections.within("Archive")',
  'collections.contains("Archive/Old")',
  'collections.contains("Archive")',
  'collections.within("Thesis/Methods")',
  'collections.within("Methods")',
  'collections.within("Thesis/")',
  'collections.within("")',
  'collections.contains("")',
  'collections.contains("Thesis/Methods") || collections.contains("Teaching/Methods")',
  'collections.contains("Teaching/Methods") || publisher == "Sage"',
  'collections.within("Thesis") && volume == "12"',
  'collections.within("Thesis") && tags.contains("to-read")',
  "attachments",
  "!attachments",
  'attachments && key == "ART2FULL"',
  // List helpers without an element expression.
  'tags.sort()[0] == "tie"',
  'tags.sort() == ["to-read", "To-Read"]',
  'tags.sort().join(",") == "Éclair,eclair,100%_raw\\path"',
  'tags.reverse()[0] == "to-read"',
  "tags.reverse() == tags",
  'tags.slice(0, 1).contains("tie")',
  'tags.slice(-1) == ["to-read"]',
  "tags.slice(1).isEmpty()",
  "tags.slice(0, null).length > 0",
  "tags.unique().length == tags.length",
  "creators.unique().length < creators.length",
  'creators.unique() == ["Grace Hopper"]',
  'creators.join("; ") == "Grace Hopper; Grace Hopper"',
  'creators.join(", ").contains("Lovelace")',
  'tags.join(",").contains("tie")',
  'collections.join("|") == ""',
  '[tags, collections].flat().contains("to-read")',
  "[tags, collections].flat().length > 2",
  '[title, publisher].sort()[0] == "Sage"',
  "[publisher, title].sort()[-1] == null",
  "[date, dateAdded].sort()[0] == date",
  'tags.sort().reverse().slice(0, 1).unique().flat().join("") == "tie"',
  '[tags, creators].flat().unique().sort().join(" ").contains("Same tie")',
  // Element expressions: value, index, and acc bound inside the expression.
  'creators.filter(value.contains("Lovelace")).length > 0',
  'creators.filter(value.contains("Lovelace")).length == 0',
  'creators.filter(index == 0).contains("Grace Hopper")',
  'creators.filter(index > 0).contains("Grace Hopper")',
  'tags.filter(value.startsWith("no-such")).length > 0',
  'tags.filter(value.contains("tie")).map(index).contains(0)',
  'tags.filter(value == "group-only").isEmpty()',
  'tags.map(value.lower()).contains("to-read")',
  "tags.map(value.lower()).unique().length < tags.length",
  'creators.map(value.lower()).contains("sam same")',
  "tags.map(index).length == tags.length",
  "tags.reduce(acc + value.length, 0) > 20",
  "tags.reduce(acc + value.length, 0) > 24",
  "tags.reduce(acc + 1, 0) == 3",
  'tags.reduce(acc + value, null) == "tie"',
  'tags.reduce(acc + ", " + value, title).startsWith("Same Title, tie")',
  "[tags, creators].map(value.length).reduce(acc + value, 0) == 0",
  '[tags, collections].map(value.filter(value.contains("e")).length).reduce(acc + value, 0) > 1',
  'tags.filter(mood == "calm").length > 0',
  'tags.filter(value == custom["value"]).isEmpty()',
  "[tags.filter(index == 0), creators.filter(index == 0)].flat().unique().length == 2",
  // Dates under the Query Clock of the test: partial dates, timestamps, and
  // date arithmetic.
  'date >= date("2020")',
  'date == date("2019-11-30")',
  'date == date("2021-06")',
  'date <= date("2018-01-01")',
  'date == date("2024-02-29")',
  "date == null",
  'date.year == 2021 && tags.contains("tie")',
  'dateAdded >= now() - duration("1 year")',
  'dateAdded.date() == date("2020-01-07")',
  "dateModified > dateAdded",
  '(date + duration("1M")) == date("2018-01-15")',
  "number(dateModified) > number(dateAdded)",
  "date(dateAdded) == dateAdded",
  "max(number(volume), 3) > 3",
  'dateAdded < date("2020-01-07 05:00Z") && key == "CNF2TEXT"',
  'dateAdded.format("YYYY") == "2021" || tags.contains("to-read")',
  "today() == now().date()",
  "accessDate == null",
  "!accessDate",
  'accessDate.date() == date("2020-01-07")',
  "date(title) == null",
  // Typed failures: every plan gives the same failure.
  "title.startsWith(1)",
  'tags.contains("tie") && title.sort().length > 0',
  'tags.contains("tie") || tags.join(1) == ""',
  'tags.contains("tie") && title.filter(value).length > 0',
  "tags.filter(noSuchFunction(value)).isEmpty()",
  "[].map(index.lower()).isEmpty()",
  "volume.toFixed(1)",
  'tags.split(" ")',
  "title.contains(/a/)",
  "title.matches(/a/)",
  "/(/.matches(title)",
  'tags.contains("tie") && /a/gg.matches(title)',
  'tags.contains("tie") && noSuchFunction()',
  'key == "ART2FULL" && noSuchField == 1',
  'tags.contains("tie") || custom["Review.Status"] == "done"',
  // Formulas: alone, beside a leaf that lowers, through another Formula, in
  // an element predicate, and over a custom field. A Formula never lowers.
  "formula.year > 2018",
  'formula.decade == 2010 && tags.contains("to-read")',
  'formula.tagged || indexedKey == "ART2FULL"',
  "!formula.tagged && formula.year > 2018",
  "formula.lovelace",
  'formula.status == "done"',
  'attachments.filter(value.contentType == "application/pdf" && formula.year > 2000).length > 0',
  // Typed failure: a Formula the scenario does not define.
  "formula.noSuchFormula > 0",
];

/**
 * The Items that a subset of {@link FILTERS} matches, by Indexed Key, worked
 * out from the seed of `@zotlit/db/test-scenario`. The live top-level Items
 * are ten in the personal Library (ART2FULL, BK2MNTH2, CHP2YEAR, CNF2TEXT,
 * RPT2NDTE, ALS2CNFL, UNI2CDE2, TIE2AAAA, TIE2BBBB, TIE2CCCC) and two in the
 * group Library (ART2FULLg4815, GRP2BK22g4815). TRS2SHED and GRP2TRSH are in
 * the trash; PDF2LIVE and the other child rows are no Items.
 */
const PERSONAL = [
  "ART2FULL",
  "BK2MNTH2",
  "CHP2YEAR",
  "CNF2TEXT",
  "RPT2NDTE",
  "ALS2CNFL",
  "UNI2CDE2",
  "TIE2AAAA",
  "TIE2BBBB",
  "TIE2CCCC",
] as const;
const GROUP = ["ART2FULLg4815", "GRP2BK22g4815"] as const;
const EVERY_ITEM = [...PERSONAL, ...GROUP];
const except = (...keys: string[]) =>
  EVERY_ITEM.filter((key) => !keys.includes(key));

const FILTER_MATCHES: Readonly<Record<string, readonly string[]>> = {
  'indexedKey == "ART2FULL"': ["ART2FULL"],
  '"ART2FULLg4815" == indexedKey': ["ART2FULLg4815"],
  '["ART2FULL", "ART2FULLg4815"].contains(indexedKey)': [
    "ART2FULL",
    "ART2FULLg4815",
  ],
  'indexedKey == "bad"': [],
  '!(indexedKey == "ART2FULL")': except("ART2FULL"),
  "[].contains(indexedKey)": [],
  'library == "personal"': PERSONAL,
  'library == "group:4815"': GROUP,
  'library == "group:4815" && key == "ART2FULL"': ["ART2FULLg4815"],
  true: EVERY_ITEM,
  false: [],
  'itemType == "book"': ["BK2MNTH2", "GRP2BK22g4815"],
  'itemType == "book" && key != "ART2FULL"': ["BK2MNTH2", "GRP2BK22g4815"],
  // Tags: to-read on ART2FULL, BK2MNTH2, and the group ART2FULL; methods on
  // ART2FULL and ALS2CNFL; tie on the three TIE2 Items; group-only on
  // GRP2BK22; three Tags on UNI2CDE2; none on CHP2YEAR, CNF2TEXT, RPT2NDTE.
  'tags.contains("to-read")': ["ART2FULL", "BK2MNTH2", "ART2FULLg4815"],
  'tags.contains("tie")': ["TIE2AAAA", "TIE2BBBB", "TIE2CCCC"],
  'tags.contains("methods")': ["ART2FULL", "ALS2CNFL"],
  'tags.contains("group-only")': ["GRP2BK22g4815"],
  'tags.containsAny("tie", "methods")': [
    "ART2FULL",
    "ALS2CNFL",
    "TIE2AAAA",
    "TIE2BBBB",
    "TIE2CCCC",
  ],
  'tags.containsAll("to-read", "methods")': ["ART2FULL"],
  "tags.isEmpty()": ["CHP2YEAR", "CNF2TEXT", "RPT2NDTE"],
  "tags.length > 1": ["ART2FULL", "UNI2CDE2"],
  'tags.contains("to-read") && itemType == "book"': ["BK2MNTH2"],
  'tags.contains("tie") && key == "TIE2BBBB"': ["TIE2BBBB"],
  'tags.contains("tie") && !tags.contains("tie")': [],
  // Zotero Key: ART2FULL in both Libraries.
  'key == "ART2FULL"': ["ART2FULL", "ART2FULLg4815"],
  'key == "GRP2BK22"': ["GRP2BK22g4815"],
  'key == "TRS2SHED"': [],
  'key == "PDF2LIVE"': [],
  'key == "NOSUCHKY"': [],
  'key != "ART2FULL"': except("ART2FULL", "ART2FULLg4815"),
  'key == "ART2FULL" || key == "BK2MNTH2" || key == "GRP2BK22"': [
    "ART2FULL",
    "BK2MNTH2",
    "ART2FULLg4815",
    "GRP2BK22g4815",
  ],
  // Fields: the TIE2 pair shares a title and TIE2CCCC has none.
  'title == "Same Title"': ["TIE2AAAA", "TIE2BBBB"],
  "title == null": ["TIE2CCCC"],
  'title.startsWith("Lab")': ["RPT2NDTE"],
  'title == "Trashed Article"': [],
  'title == "Group Copy of Exact Matching"': ["ART2FULLg4815"],
  'publisher == "Sage" || publisher == "Academic Press"': [
    "BK2MNTH2",
    "CHP2YEAR",
  ],
  'mood == "calm"': ["ART2FULL"],
  // Creators: two on ART2FULL, BK2MNTH2, CHP2YEAR; none on RPT2NDTE,
  // ALS2CNFL, TIE2CCCC, and GRP2BK22.
  "creators.length == 2": ["ART2FULL", "BK2MNTH2", "CHP2YEAR"],
  "creators.isEmpty()": ["RPT2NDTE", "ALS2CNFL", "TIE2CCCC", "GRP2BK22g4815"],
  'itemType == "report" && creators.isEmpty()': ["RPT2NDTE"],
  // Collections: ART2FULL and CHP2YEAR in Thesis/Methods, CHP2YEAR in Thesis
  // too, BK2MNTH2 in Teaching/Methods.
  'collections.contains("Thesis/Methods")': ["ART2FULL", "CHP2YEAR"],
  'collections.contains("Teaching/Methods")': ["BK2MNTH2"],
  'collections.within("Thesis")': ["ART2FULL", "CHP2YEAR"],
  // PDF2LIVE is the one live Attachment, on ART2FULL.
  attachments: ["ART2FULL"],
  "!attachments": except("ART2FULL"),
};

/**
 * RPT2NDTE was accessed at 04:00Z on 2020-01-07 and CHP2YEAR on the calendar
 * day 2020-01-07; UNI2CDE2 stores an access date that does not parse. The
 * day starts after the timestamp in New York and before it in UTC and Tokyo.
 */
const NEW_YORK = { now: "2020-01-08T02:00:00Z", timeZone: "America/New_York" };
const TOKYO = { now: "2020-01-08T02:00:00Z", timeZone: "Asia/Tokyo" };
const byAccessDate = (direction: SortSpec["direction"]): SortSpec[] => [
  { field: "accessDate", direction },
];

/** The scenario requests that the filter list does not give. */
const REQUESTS: readonly ScenarioQuery[] = [
  {
    name: "lastActivitySource projection with Uses",
    libraries: ["personal", "group"],
    request: {
      fields: ["lastActivity", "lastActivitySource"],
      sort: [{ field: "lastActivity", direction: "desc" }],
      uses: { ART2FULL: 4102444800000 },
      limit: 4,
    },
  },
  {
    name: "lastActivitySource filter",
    libraries: ["personal", "group"],
    request: {
      fields: ["lastActivitySource"],
      filter: 'lastActivitySource == "added" || lastActivitySource == null',
      sort: [{ field: "lastActivity", direction: "asc" }],
    },
  },
  {
    name: "lastRead filter, projection and sort",
    libraries: ["personal", "group"],
    request: {
      fields: ["lastRead"],
      filter: "lastRead == null",
      sort: [{ field: "lastRead", direction: "desc" }],
      limit: 2,
    },
  },
  ...[
    "library",
    "date.year",
    'custom["review.status"]',
    "dateModified",
    "creators[0].fullName",
    "tags",
    "creators[].fullName",
    "tags[].name",
    "collections[]",
    "attachments[].fileType",
    "attachments[].tags[]",
  ].flatMap((group) => [
    {
      name: `group ${group}`,
      libraries: ["personal", "group"] as const,
      request: { group, fields: [], limit: 2 },
    },
  ]),
  {
    name: "Query Context Item by Indexed Key",
    libraries: ["personal", "group"],
    request: {
      filter: "indexedKey == this.item.indexedKey",
      context: { item: "ART2FULLg4815" },
    },
  },
  {
    name: "element group over a candidate set",
    libraries: ["personal", "group"],
    request: {
      filter: 'tags.contains("to-read")',
      group: "tags[].name",
      fields: ["tags[].name"],
      limit: 1,
    },
  },
  {
    name: "Relation List element projection",
    libraries: ["personal", "group"],
    request: {
      fields: [
        "creators[].fullName",
        "creators[].literal",
        "tags[].name",
        "collections[]",
      ],
    },
  },
  {
    name: "Formulas over a candidate set, with a custom field and a date",
    libraries: ["personal", "group"],
    request: {
      filter: 'tags.contains("to-read")',
      formulas: {
        status: 'custom["review.status"]',
        published: "date",
        authors: "creators.length",
        unused: "title",
      },
      fields: [
        "title",
        "formula.authors",
        "formula.status",
        "formula.published",
      ],
    },
  },
  {
    name: "Formulas with Error Values over a candidate set and the scan",
    libraries: ["personal", "group"],
    request: {
      filter: 'tags.contains("to-read") || number(title) > 0',
      formulas: {
        volume: "number(volume)",
        title: "number(title)",
        order: 'date > "2019"',
        parts: "[number(title), title.length]",
      },
      fields: [
        "title",
        "formula.volume",
        "formula.title",
        "formula.order",
        "formula.parts",
      ],
    },
  },
  {
    name: "Formulas with mistakes left out over a candidate set",
    libraries: ["personal", "group"],
    request: {
      filter: 'tags.contains("to-read")',
      formulas: {
        authors: "creators.length",
        bad: "title * 2",
        reader: "formula.bad + 1",
      },
      fields: ["title", "formula.authors", "formula.reader", "formula.zz"],
      onFormulaFault: "leave-out",
    },
  },
  { name: "no filter, defaults", libraries: ["personal"], request: {} },
  { name: "no filter, defaults, group", libraries: ["group"], request: {} },
  {
    name: "no filter, defaults, both Libraries",
    libraries: ["personal", "group"],
    request: {},
  },
  {
    name: "no filter, both Libraries, limit inside the first Library",
    libraries: ["personal", "group"],
    request: { fields: [], sort: [], limit: 2 },
  },
  {
    name: "no filter, both Libraries, limit equal to the Items",
    libraries: ["personal", "group"],
    request: { fields: ["dateModified"], limit: 12 },
  },
  {
    name: "no filter, both Libraries, every relation, tie-heavy sort",
    libraries: ["group", "personal"],
    request: {
      fields: ["creators", "tags", "collections", "attachments", "custom"],
      sort: [
        { field: "itemType", direction: "asc" },
        { field: "date", direction: "desc" },
      ],
    },
  },
  {
    name: "Tag in both Libraries, default projection, limit 2",
    libraries: ["personal", "group"],
    request: { filter: 'tags.contains("to-read")', limit: 2 },
  },
  {
    name: "Collection leaf name of both Libraries, both Libraries",
    libraries: ["personal", "group"],
    request: {
      filter: 'collections.contains("Methods") || collections.within("Thesis")',
      fields: ["collections"],
      limit: null,
    },
  },
  {
    name: "no filter, identity-only, limit 2",
    libraries: ["personal"],
    request: { fields: [], limit: 2 },
  },
  {
    name: "no filter, limit equal to the Library",
    libraries: ["personal"],
    request: { fields: ["dateAdded", "itemType"], limit: 10 },
  },
  {
    name: "no filter, structured dates in key order",
    libraries: ["personal"],
    request: {
      fields: ["date", "date.year", "date.month", "date.day", "date.raw"],
      sort: [],
    },
  },
  {
    name: "no filter, every relation, tie-heavy sort",
    libraries: ["personal"],
    request: {
      fields: ["creators", "tags", "collections", "attachments", "custom"],
      sort: [
        { field: "date", direction: "asc" },
        { field: "title", direction: "desc" },
      ],
    },
  },
  {
    name: "no filter, null-heavy sort, limit 4",
    libraries: ["personal"],
    request: {
      fields: ["volume"],
      sort: [{ field: "volume", direction: "desc" }],
      limit: 4,
    },
  },
  {
    name: "Tag filter, sort, limit, and projection",
    libraries: ["personal"],
    request: {
      filter: 'tags.contains("tie")',
      fields: ["title", "tags[0].name"],
      sort: [{ field: "title", direction: "desc" }],
      limit: 2,
    },
  },
  {
    name: "Tag filter, limit equal to the matches",
    libraries: ["personal"],
    request: { filter: 'tags.contains("tie")', limit: 3 },
  },
  {
    name: "Tag filter, limit above the matches",
    libraries: ["personal"],
    request: { filter: 'tags.contains("tie")', limit: 4 },
  },
  {
    name: "key filter, default projection, group",
    libraries: ["group"],
    request: { filter: 'key == "ART2FULL"' },
  },
  {
    name: "key filter, unknown custom field in the projection",
    libraries: ["personal"],
    request: {
      filter: 'key == "ART2FULL"',
      fields: ['custom["Review.Status"]'],
    },
  },
  {
    name: "one Item through several aliases, Tags, and Collections",
    libraries: ["personal"],
    request: {
      filter:
        'publicationTitle == "Type-Specific Host" || publicationTitle == "Base Field Host" || tags.contains("to-read") || tags.contains("To-Read") || collections.within("Thesis") || collections.contains("Thesis/Methods")',
      fields: ["title", "tags", "collections"],
      limit: null,
    },
  },
  {
    name: "field-value filter, sort, limit, and projection",
    libraries: ["personal"],
    request: {
      filter: 'publicationTitle == "Tie Journal"',
      fields: ["title", "volume"],
      sort: [{ field: "volume", direction: "asc" }],
      limit: 2,
    },
  },
  {
    name: "Tag filter, unsortable field",
    libraries: ["personal"],
    request: {
      filter: 'tags.contains("tie")',
      sort: [{ field: "tags", direction: "asc" }],
    },
  },
  {
    name: "today() on the calendar day of New York",
    libraries: ["personal"],
    request: { filter: "dateAdded >= today()", fields: [], sort: [] },
    now: "2020-01-08T02:00:00Z",
    timeZone: "America/New_York",
  },
  {
    name: "Tag filter and a timestamp window, limit 1",
    libraries: ["personal"],
    request: {
      filter: 'tags.contains("to-read") && dateAdded > now() - duration("1d")',
      fields: ["dateAdded"],
      limit: 1,
    },
    now: "2020-01-08T02:00:00Z",
    timeZone: "America/New_York",
  },
  {
    name: "accessDate ascending in New York, with its projection",
    libraries: ["personal"],
    request: { fields: ["accessDate"], sort: byAccessDate("asc") },
    ...NEW_YORK,
  },
  {
    name: "accessDate descending in New York, limit 2",
    libraries: ["personal"],
    request: { fields: ["accessDate"], sort: byAccessDate("desc"), limit: 2 },
    ...NEW_YORK,
  },
  {
    name: "accessDate ascending in Tokyo, limit 1",
    libraries: ["personal"],
    request: { fields: ["accessDate"], sort: byAccessDate("asc"), limit: 1 },
    ...TOKYO,
  },
  {
    name: "accessDate descending in UTC, both Libraries",
    libraries: ["personal", "group"],
    request: { fields: ["accessDate"], sort: byAccessDate("desc") },
  },
  {
    name: "accessDate on or after a calendar day in New York",
    libraries: ["personal"],
    request: {
      filter: 'accessDate >= date("2020-01-07")',
      fields: ["accessDate"],
      sort: byAccessDate("asc"),
    },
    ...NEW_YORK,
  },
];

/** Named regressions retained alongside every scenario filter and request. */
const NAMED_CASES: readonly ScenarioQuery[] = [];

/** Each filter with matches is in {@link FILTERS}. */
export const PINNED_FILTERS: readonly string[] = Object.keys(FILTER_MATCHES);

export const SCENARIO_QUERIES: readonly ScenarioQuery[] = [
  ...FILTERS.map(
    (filter): ScenarioQuery => ({
      name: `${filter} [both Libraries, key order]`,
      libraries: ["personal", "group"],
      request: { filter, ...scenarioFormulas(filter), fields: [], sort: [] },
      ...(FILTER_MATCHES[filter] ? { matches: FILTER_MATCHES[filter] } : {}),
    }),
  ),
  ...REQUESTS,
  ...NAMED_CASES,
];
