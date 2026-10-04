// The query list of the scenario: the one place the parity suite reads. Every
// query runs on the scenario database (`@zotlit/db/test-scenario`) with each
// plan and chunk size, and each run must give the Query Result of the forced
// scan. Add an entry for each new scenario query, leaf, or function.
import type { ScenarioLibraryName } from "@zotlit/db/test-scenario";

import type { ItemQueryRequest, SortSpec } from "./request";

export interface ScenarioQuery {
  /** A unique name; it names the test. */
  readonly name: string;
  readonly library: ScenarioLibraryName;
  readonly request: Omit<ItemQueryRequest, "library">;
  /** The instant of the Query Clock, as an ISO string. Omitted: the test default. */
  readonly now?: string;
  /** The zone of the Query Clock. Omitted: the test default. */
  readonly timeZone?: string;
}

/**
 * The Filter Expressions of the scenario. Each one runs in both Libraries as
 * an unlimited identity-only query in key order, and in the personal Library
 * as a limited, sorted query with a projection.
 */
const FILTERS: readonly string[] = [
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
  // Relation lists and Attachment presence.
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
  'dateAdded < date("2020-01-07 05:00Z") && key == "CNF2TEXT"',
  'dateAdded.format("YYYY") == "2021" || tags.contains("to-read")',
  "today() == now().date()",
  "accessDate == null",
  "date(title) == null",
  // Typed failures: every plan gives the same failure.
  "title.startsWith(1)",
  'tags.contains("tie") && noSuchFunction()',
  'key == "ART2FULL" && noSuchField == 1',
  'tags.contains("tie") || custom["Review.Status"] == "done"',
];

const byTitleThenVolume: readonly SortSpec[] = [
  { field: "title", direction: "desc" },
  { field: "volume", direction: "asc" },
];

/** The scenario requests that the filter list does not give. */
const REQUESTS: readonly ScenarioQuery[] = [
  { name: "no filter, defaults", library: "personal", request: {} },
  { name: "no filter, defaults, group", library: "group", request: {} },
  {
    name: "no filter, identity-only, limit 2",
    library: "personal",
    request: { fields: [], limit: 2 },
  },
  {
    name: "no filter, limit equal to the Library",
    library: "personal",
    request: { fields: ["dateAdded", "itemType"], limit: 10 },
  },
  {
    name: "no filter, structured dates in key order",
    library: "personal",
    request: {
      fields: ["date", "date.year", "date.month", "date.day", "date.raw"],
      sort: [],
    },
  },
  {
    name: "no filter, every relation, tie-heavy sort",
    library: "personal",
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
    library: "personal",
    request: {
      fields: ["volume"],
      sort: [{ field: "volume", direction: "desc" }],
      limit: 4,
    },
  },
  {
    name: "Tag filter, sort, limit, and projection",
    library: "personal",
    request: {
      filter: 'tags.contains("tie")',
      fields: ["title", "tags[0].name"],
      sort: [{ field: "title", direction: "desc" }],
      limit: 2,
    },
  },
  {
    name: "Tag filter, limit equal to the matches",
    library: "personal",
    request: { filter: 'tags.contains("tie")', limit: 3 },
  },
  {
    name: "Tag filter, limit above the matches",
    library: "personal",
    request: { filter: 'tags.contains("tie")', limit: 4 },
  },
  {
    name: "key filter, default projection, group",
    library: "group",
    request: { filter: 'key == "ART2FULL"' },
  },
  {
    name: "key filter, unknown custom field in the projection",
    library: "personal",
    request: {
      filter: 'key == "ART2FULL"',
      fields: ['custom["Review.Status"]'],
    },
  },
  {
    name: "one Item through several aliases, Tags, and Collections",
    library: "personal",
    request: {
      filter:
        'publicationTitle == "Type-Specific Host" || publicationTitle == "Base Field Host" || tags.contains("to-read") || tags.contains("To-Read") || collections.within("Thesis") || collections.contains("Thesis/Methods")',
      fields: ["title", "tags", "collections"],
      limit: null,
    },
  },
  {
    name: "field-value filter, sort, limit, and projection",
    library: "personal",
    request: {
      filter: 'publicationTitle == "Tie Journal"',
      fields: ["title", "volume"],
      sort: [{ field: "volume", direction: "asc" }],
      limit: 2,
    },
  },
  {
    name: "Tag filter, unsortable field",
    library: "personal",
    request: {
      filter: 'tags.contains("tie")',
      sort: [{ field: "tags", direction: "asc" }],
    },
  },
  {
    name: "today() on the calendar day of New York",
    library: "personal",
    request: { filter: "dateAdded >= today()", fields: [], sort: [] },
    now: "2020-01-08T02:00:00Z",
    timeZone: "America/New_York",
  },
  {
    name: "Tag filter and a timestamp window, limit 1",
    library: "personal",
    request: {
      filter: 'tags.contains("to-read") && dateAdded > now() - duration("1d")',
      fields: ["dateAdded"],
      limit: 1,
    },
    now: "2020-01-08T02:00:00Z",
    timeZone: "America/New_York",
  },
];

/**
 * The cases that the generated combinations of the parity suite found. When a
 * generated query fails, its message prints the entry to add here; the case
 * then runs by name after the fix, whatever the generator gives later.
 */
const NAMED_CASES: readonly ScenarioQuery[] = [];

export const SCENARIO_QUERIES: readonly ScenarioQuery[] = [
  ...FILTERS.flatMap((filter): ScenarioQuery[] => [
    {
      name: `${filter} [personal, key order]`,
      library: "personal",
      request: { filter, fields: [], sort: [] },
    },
    {
      name: `${filter} [group, key order]`,
      library: "group",
      request: { filter, fields: [], sort: [] },
    },
    {
      name: `${filter} [personal, sorted, limit 2]`,
      library: "personal",
      request: {
        filter,
        fields: ["title", "tags", "date.year"],
        sort: byTitleThenVolume,
        limit: 2,
      },
    },
  ]),
  ...REQUESTS,
  ...NAMED_CASES,
];

/**
 * The parts from which the parity suite generates filter combinations. The
 * suite joins them with `&&`, `||`, `!`, `==`, and `if()`. Add each new leaf
 * form here with values that match no Item, one Item, and several Items.
 */
export const GENERATED_FILTER_PARTS: readonly string[] = [
  // Lowered leaves.
  'tags.contains("to-read")',
  'tags.contains("To-Read")',
  'tags.contains("tie")',
  'tags.contains("methods")',
  'tags.contains("eclair")',
  'tags.contains("group-only")',
  'tags.contains("no-such-tag")',
  'key == "ART2FULL"',
  'key == "BK2MNTH2"',
  'key == "TIE2CCCC"',
  '"GRP2BK22" == key',
  'key == "TRS2SHED"',
  'key == "PDF2LIVE"',
  'key == "NOSUCHKY"',
  'publicationTitle == "Handbook of Methods"',
  'publicationTitle == "Base Field Host"',
  '"Tie Journal" == publicationTitle',
  'publisher == "Group Press"',
  'title == "Same Title"',
  'title == "Trashed Article"',
  'volume == "12"',
  'collections.contains("Thesis/Methods")',
  'collections.contains("Teaching/Methods")',
  'collections.contains("Methods")',
  'collections.within("Thesis")',
  'collections.within("Archive")',
  // Other expressions.
  "true",
  "false",
  "null",
  'itemType == "book"',
  'itemType == "journalArticle"',
  'key != "ART2FULL"',
  'title.startsWith("Same")',
  "title == null",
  'title.contains("e")',
  "volume == 12",
  'publisher.startsWith("Sage")',
  'mood == "calm"',
  "tags.length > 1",
  'tags.containsAny("tie", "methods")',
  "creators.isEmpty()",
  "collections.length == 2",
  "attachments",
  'date >= date("2021")',
  'date == date("2019-11")',
  'dateAdded >= date("2022")',
];
