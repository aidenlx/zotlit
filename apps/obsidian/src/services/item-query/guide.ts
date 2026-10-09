// The Item Query guide: tiered literal-English text, after the Template
// Workbench guide. Every command and Filter Expression it shows comes from
// `example` or `filter` below, so a test runs each one against a real query.
// Command names, parameters, and defaults come from the constants the
// handlers run.

import { ITEMS } from "@zotlit/item-query";

import {
  DEFAULT_CLI_LIMIT,
  DIAGNOSTIC_HINTS,
  ITEM_QUERY_CANCEL_COMMAND,
  ITEM_QUERY_COMMAND,
  INLINE_MAX_BYTES,
  ITEM_QUERY_GUIDE_COMMAND,
  ITEM_QUERY_SCHEMA_COMMAND,
  itemQueryFlags,
  QUERY_ID_FORM,
  queryCancelledText,
} from "./contract";

/** One query command of the guide, as flat CLI arguments. */
export type GuideExample = Readonly<Record<string, string>>;

const examples: GuideExample[] = [];
const filters: string[] = [];

/** Every query command the guide shows. */
export const GUIDE_EXAMPLES: readonly GuideExample[] = examples;
/** Every Filter Expression the guide shows outside a command. */
export const GUIDE_FILTERS: readonly string[] = filters;

/** A query command, written with each value in single quotes. */
function example(args: GuideExample): string {
  examples.push(args);
  const parts = Object.entries(args).map(([name, value]) =>
    /^[\w:-]+$/.test(value) ? `${name}=${value}` : `${name}='${value}'`,
  );
  return [`obsidian ${ITEM_QUERY_COMMAND}`, ...parts].join(" ");
}

/** "a, b, and c". */
function listOf(names: readonly string[]): string {
  return new Intl.ListFormat("en", { type: "conjunction" }).format(names);
}

const DEFAULT_FIELD_LIST = listOf(ITEMS.defaultFields);
/** The default sort in words, such as "dateModified descending". */
const DEFAULT_SORT_TEXT = listOf(
  ITEMS.defaultSort.map(
    ({ field, direction }) =>
      `${field} ${direction === "desc" ? "descending" : "ascending"}`,
  ),
);

/** The query command with each parameter, wrapped as the synopsis shows it. */
function querySynopsis(): string {
  const lines = [`obsidian ${ITEM_QUERY_COMMAND}`];
  for (const [name, flag] of Object.entries(itemQueryFlags)) {
    const parameter = `[${name}=${flag.value}]`;
    const last = lines.at(-1)!;
    if (last.length + parameter.length < 72) {
      lines[lines.length - 1] = `${last} ${parameter}`;
    } else {
      lines.push(`  ${parameter}`);
    }
  }
  return lines.join("\n  ");
}

/** Each diagnostic code of the handlers with its recovery text, wrapped. */
function diagnosticCodes(): string {
  return Object.entries(DIAGNOSTIC_HINTS)
    .map(([code, hint]) => {
      const lines = [""];
      for (const word of `${code}: ${hint}`.split(" ")) {
        const last = lines.at(-1)!;
        if (last.length + word.length < 72) {
          lines[lines.length - 1] = last === "" ? word : `${last} ${word}`;
        } else {
          lines.push(word);
        }
      }
      return lines.join("\n    ");
    })
    .join("\n  ");
}

/** A Filter Expression shown on its own line. */
function filter(expression: string): string {
  filters.push(expression);
  return expression;
}

const FILTER_SECTION = `FILTER EXPRESSIONS

DESCRIPTION
  filter selects the Items: an Item matches when the expression is true.
  Omit filter to match every top-level Item that is not in the trash.
  Join conditions with &&, ||, and !. Group them with parentheses.
  Write text in double quotes. Names are case-sensitive.

FIELDS
  A bare name is a built-in field. In the downloaded schema catalog,
  fields[].filter gives the type a filter reads. Examples:
    ${filter('itemType == "book"')}
    ${filter('title.startsWith("The")')}
  key is the Zotero Key of the Item inside its Library. Two Libraries can
  hold the same key; the Indexed Key of a row names one Item:
    ${filter('key == "ABCD2345"')}
  attachments is true when the Item has an Attachment outside the trash:
    ${filter("!attachments")}

TEXT
  ==, !=, contains, startsWith, and endsWith match exactly: case and accents
  count. Use lower() for a match that ignores case:
    ${filter('title.lower().contains("climate")')}
  Values of different types are never equal: 1 == "1" is false.

TEXT HELPERS
  trim(), title(), reverse(), slice(start, end?), repeat(count),
  replace(pattern, replacement), and split(separator, n?) work on text as
  in Obsidian Bases. replace replaces every occurrence of the text pattern;
  split gives the parts as a list. toFixed(precision) writes a number as
  text with that many decimals. isTruthy() is true when a value selects
  the Item. list(value) wraps a value that is one text on some Items and
  a list on others, so it is a list everywhere:
    ${filter('title.trim().split(":")[0] == "Climate"')}
    ${filter('title.title().startsWith("The ")')}
    ${filter('number(volume).toFixed(1) == "12.0"')}
    ${filter("publisher.isTruthy()")}
    ${filter('list(custom["review.status"]).contains("done")')}

REGULAR EXPRESSIONS
  Write a regular expression as /pattern/flags, with JavaScript syntax
  and the flags i (ignore case), g (every occurrence), m, s, u, v, y, and d.
  matches(text) is true when the pattern matches the text. replace and
  split take a regular expression in place of a text pattern: replace
  changes the first occurrence, or every occurrence with the g flag, and
  $1 names a group. The query fails at the literal when the pattern is
  invalid.
    ${filter("/^the /i.matches(title)")}
    ${filter('title.replace(/\\s+/g, " ") == "Lab Report"')}
    ${filter('title.replace(/(\\w+), (\\w+)/, "$2 $1").startsWith("Ada")')}
    ${filter('title.split(/[:—]/, 2)[0].trim() == "Climate"')}

TAGS, COLLECTIONS, AND CREATORS
  tags, collections, and creators are lists of text.
    ${filter('tags.contains("to-read")')}
    ${filter('tags.containsAny("to-read", "cited")')}
  A Collection is its full path from the top-level Collection of its
  Library, joined by /. A path matches in each Library that has it.
  within matches that Collection and every Collection below it:
    ${filter('collections.contains("Thesis/Methods")')}
    ${filter('collections.within("Thesis")')}
  A Creator is the full name, given name first:
    ${filter('creators.contains("Ada Lovelace")')}

LIST HELPERS
  sort() orders a list: numbers by value, text in the order a sort on a
  text field uses, dates by their start, and null last; unique() keeps
  the first of equal elements; reverse() turns the list around;
  slice(start, end) takes a part, and a negative index counts from the
  end; join(separator) writes the elements as one text, a null element as
  empty text; flat() opens one level of nested lists. Each one gives a new
  list and leaves the field as it is.
    ${filter('tags.sort()[0] == "to-read"')}
    ${filter("creators.unique().length == 1")}
    ${filter('tags.slice(0, 2).contains("methods")')}
    ${filter('creators.join("; ").contains("Lovelace; ")')}
    ${filter('[tags, collections].flat().contains("to-read")')}

ELEMENT EXPRESSIONS
  filter(expression), map(expression), and reduce(expression, initial)
  run an expression once for each element of a list. Inside it, value is
  the element, index is its position from 0, and in reduce acc is the
  running result, which starts at initial. filter keeps the elements for
  which the expression is true; map gives the list of results; reduce
  gives the final acc. Outside the expression, value, index, and acc are
  custom fields with those names. The downloaded catalog's methods[].scope
  lists the names.
    ${filter('creators.filter(value.contains("Lovelace")).length > 0')}
    ${filter('tags.map(value.lower()).contains("to-read")')}
    ${filter("tags.reduce(acc + value.length, 0) > 20")}
    ${filter('creators.filter(index == 0).contains("Ada Lovelace")')}
    ${filter("[tags, collections].map(value.length).reduce(acc + value, 0) > 2")}

DATES
  date and the other Zotero date fields are calendar dates at the precision
  the Item gives: a year, a month, or a day. dateAdded and dateModified are
  timestamps. accessDate is a timestamp, or a day when Zotero stores only a
  day; another stored accessDate is null. Calendar days follow the time zone
  of this computer.
    ${filter("date.year >= 2020")}
    ${filter('date == date("2020")')}
    ${filter('dateAdded >= today() - duration("7 days")')}
  A year-only date equals every day of that year.

CUSTOM FIELDS
  Read a custom field as custom["<exact name>"]. The schema command's
  customFields list names each one; its path is ready to use. A custom field
  whose bareName is true
  also has a short form: its name alone. A bare name always means the
  built-in field when one has that name.

ERRORS AND EMPTY VALUES
  Invalid syntax, unknown names, and wrong argument counts or types fail the
  query, also inside an if branch. Read diagnostic.report for the marked text
  and recovery action; suggestions gives available corrections.
  A comparison of incompatible types can produce a warning on a successful
  query. Read warnings before you report an empty result. A warning describes
  the marked comparison, which can be part of a larger filter. Equality
  warnings require proof that the operands cannot both be null; ordering
  different types is never true. A filter without warnings can still match no Items.
  A value that is missing or unreadable for one Item is null for that Item.
  null is false in a filter, so !x is true when x is null. This selects the
  Items from 2000 on and the Items without a year:
    ${filter("!(date.year < 2000)")}

SEE ALSO
  The downloaded catalog's functions, methods, and properties list every
  call with its parameters. Read guide topic=schema to obtain the catalog.`;

const FIELDS_SECTION = `FIELDS AND PROJECTION PATHS

DESCRIPTION
  fields is a JSON array of Projection Paths: the values each row returns.
  Without fields, each row has ${DEFAULT_FIELD_LIST}.
  Use fields='[]' to return only the Indexed Keys.
    ${example({ fields: "[]", limit: "all" })}

PATHS
  A path selects a field or a value inside it, as in a ZotLit template:
  date.year, creators[0].fullName, tags[1].name. Each entry of
  the downloaded catalog's fields with projection true is a path.
  A list path shows index 0;
  any index works.
    ${example({ fields: '["title","date.year","creators[0].fullName","tags","attachments"]' })}
  A custom field is the path custom["<exact name>"]; copy it from
  customFields[].path in the schema command's response.

VALUES
  Each row has every requested path. A missing value is null; an empty list
  is []. Timestamps and dates are ISO 8601 text, such as
  2024-06-01T10:00:00Z, 2020-03-15, or 2019-11.`;

const SORT_SECTION = `SORT AND LIMIT

SORT
  sort is a JSON array of {"field","direction"} objects; direction is "asc"
  or "desc". The first entry orders first. A Sortable Field has sort true in
  the downloaded catalog's fields: one value per Item, such as title, date,
  or dateModified.
    ${example({ sort: '[{"field":"date","direction":"desc"},{"field":"title","direction":"asc"}]' })}
  The default is ${DEFAULT_SORT_TEXT}.
  Items without a value come last in both directions. The Indexed Key orders
  Items that tie on every entry, also Items of two Libraries.

ORDER OF TEXT
  Text sorts in one alphabetical order on every computer. Digits come before
  letters and compare digit by digit, so 10 comes before 9. Case and accents
  only break ties: eclair comes before Éclair, and both come before Zebra.

ORDER OF DATES
  A date sorts as its first possible day: 2020 sorts as 1 January 2020.
  A date without a year comes last. accessDate sorts by time; a day sorts
  from its start in the time zone of this computer.

LIMIT
  limit is the most rows to return: a positive integer, or all for every
  match. The default is ${DEFAULT_CLI_LIMIT}. truncated is true when more Items match.
  The Items of all the Libraries of a query are sorted and limited together.
    ${example({ sort: '[{"field":"title","direction":"asc"}]', limit: "all" })}`;

const RESULTS_SECTION = `RESULTS AND DIAGNOSTICS

ENVELOPE
  Query, schema, and cancel answers are JSON with contractVersion, command,
  and ok. The guide prints text.
  On success, the query answer has identity (the vault and the Zotero
  source), libraries, request (the query after defaults), returnedCount,
  truncated, warnings, and rows. Each row is {"indexedKey","values"}; values has one
  entry for each path in request.fields.
  warnings is an array of diagnostics, empty when there are no warnings.
  Read warnings before you report an empty result. File receipts include it too.
  libraries lists each Library the query read, My Library first and then
  the groups by group ID. Each entry is {"type":"personal"} or
  {"type":"group","groupID","name"}. request.libraries has the same
  Libraries in the form of the libraries argument.
  The Indexed Key of an Item in a group ends with g and the group ID.

FILE EXPORTS
  Inline responses contain at most ${INLINE_MAX_BYTES} UTF-8 bytes. For a large
  result, add output=<absolute-path> with a new filename in an existing
  directory. The file contains the complete JSON envelope described above.
  The CLI returns the same metadata with file instead of rows:
  file.path is the absolute path, file.bytes is the UTF-8 byte count, and
  file.format is json. Read that file to get the Query Rows.
  The export becomes available when the complete file is written. An existing
  file is kept intact. Cancellation removes the unpublished file.
  Example: add output=/absolute/path/items.json to a limit=all query.

DIAGNOSTICS
  Read diagnostic.report first on failure, or each warnings entry's report
  on success. Each array entry is one line: message first, hint last, with
  an excerpt, caret, and explanatory notes between them when available.
  Follow the recovery action, then run the corrected query.
  On failure, ok is false and diagnostic describes the error. Warnings use
  the same fields and leave ok true:
    code identifies the kind of diagnostic.
    message is the summary; hint is the most specific recovery action.
    severity is error on failure and warning for a Query Warning.
    excerpt contains before, at, and after; at is the exact marked text.
      The caret aligns with the JSON-escaped excerpt in the pretty JSON envelope.
    found is the received value or type, or an empty string when unavailable.
    expected lists allowed forms, or an empty array when unavailable.
    suggestions lists candidate names or corrected arguments, or an empty array.
      Use the report to distinguish candidates from a complete correction.
    location.argument names the argument. index is the position in fields or sort.
      span gives filter character offsets from (inclusive) to to (exclusive),
      measured in UTF-16. path identifies a JSON position, such as sort[0].direction.
    details carries additional context, such as the rejected parameter name.
  Operational failures have two report lines, message and hint, and no excerpt.
  Query errors have codes such as unknown-field. The adapter's registered codes
  and default recovery actions follow; a diagnostic can give a more specific action:
  ${diagnosticCodes()}`;

const CANCEL_SECTION = `CANCEL A RUNNING QUERY

NAME THE QUERY
  Give a query an id when you start it; a second CLI call can then stop it.
  An id has ${QUERY_ID_FORM}, and names one
  running query in this vault:
    ${example({ id: "export-1", limit: "all", fields: "[]" })}
  A second query with the id of a running query fails with
  query-id-in-use; the running query continues. The id is free again when
  its query finishes, fails, or is cancelled.
  Without id, a query runs as before, and only a plugin unload stops it.

CANCEL
  From a second terminal, while the query runs:
    obsidian ${ITEM_QUERY_CANCEL_COMMAND} id=export-1
  The answer is JSON with contractVersion, command, ok, id, and
  cancelRequested. cancelRequested is true when a query with this id was
  running: it stops within a moment. The cancelled call prints this text in
  place of JSON, and leaves no file at its output path:
    Error: ${queryCancelledText("export-1")}
  Queries with other ids, and queries in other vaults, continue.

QUERY ALREADY FINISHED
  cancelRequested is false when no query with this id runs in this vault:
  the query already finished, or the id was never used. This is not an
  error, and nothing changes. A query that finishes its result while the
  cancel arrives can still return it; read the answer of that call.`;

const SCHEMA_SECTION = `SCHEMA DOWNLOAD AND SOURCE FIELDS

PUBLISHED CATALOG
  ${ITEM_QUERY_SCHEMA_COMMAND} returns identity, schema, customFields, and
  defaults. schema.url downloads the static catalog for this plugin version;
  schema.fileName gives a versioned local filename. The catalog contains
  fields, functions, methods, properties, and types. customFields and defaults
  belong to the live response, including the source-specific custom paths.

CHOOSE THE CATALOG SOURCE
  An unpublished development version has no Resource Release. For a .dev
  build, use the matching source checkout: build @zotlit/item-query and read
  packages/item-query/dist/item-query.schema.json. For a released version,
  download schema.url once, using the steps below.

INSPECT LOCALLY
  Save the small live response:
    obsidian vault=<vault> ${ITEM_QUERY_SCHEMA_COMMAND} > query-source.json
    jq '{ok, identity, diagnostic}' query-source.json
  Continue when ok is true and identity names the intended source:
    curl --fail --location "$(jq -r '.schema.url' query-source.json)" --output "$(jq -r '.schema.fileName' query-source.json)"
  The catalog is large. Use jq to read only the entries the task needs:
    jq '.fields[] | select(.path == "title" or .path == "date.year")' "$(jq -r '.schema.fileName' query-source.json)"
    jq '.customFields' query-source.json
  Keep the downloaded catalog while schema.url is unchanged. Refresh the
  live response when the Zotero source or its custom fields change.`;

/** Canonical topic registry shared by parsing, generated help, and the index. */
export const GUIDE_TOPICS = {
  schema: SCHEMA_SECTION,
  filter: FILTER_SECTION,
  fields: FIELDS_SECTION,
  sort: SORT_SECTION,
  results: RESULTS_SECTION,
  cancel: CANCEL_SECTION,
} as const satisfies Record<string, string>;

export type GuideTopic = keyof typeof GUIDE_TOPICS;
export const GUIDE_TOPIC_NAMES = Object.keys(
  GUIDE_TOPICS,
) as readonly GuideTopic[];

const QUICKSTART = `ZOTLIT ITEM QUERY

Item Query finds Items in your Zotero Libraries and returns the values you
select as JSON. It reads the top-level Items outside the trash and changes
nothing in Zotero.

WORKFLOW
  Put vault=<vault> before each command and check identity in its JSON answer.
  1. Get the schema download, source custom fields, and CLI defaults.
     Read topic=schema to download once and inspect entries with jq.
  2. Run a query with filter, fields, sort, and limit.
  3. On ok false, follow diagnostic.hint and run the query again.

SYNOPSIS
  obsidian ${ITEM_QUERY_SCHEMA_COMMAND}
  ${querySynopsis()}
  obsidian ${ITEM_QUERY_CANCEL_COMMAND} id=<id>
  obsidian ${ITEM_QUERY_GUIDE_COMMAND} [topic=<${GUIDE_TOPIC_NAMES.join("|")}>]

DEFAULTS
  Without arguments, a query reads the Libraries that ZotLit searches (the
  Library scope setting) as one result set and returns at most
  ${DEFAULT_CLI_LIMIT} rows, sorted by ${DEFAULT_SORT_TEXT}.
  Each row has ${DEFAULT_FIELD_LIST}.
  defaults.libraries in the schema response names their source: the Library
  scope setting. It is no value of the libraries argument.

LIBRARIES
  library names one Library: personal (My Library), or group:<groupID>.
  The group ID is the number in the group's address on zotero.org.
    ${example({ library: "personal", limit: "5" })}
  libraries names a set as a JSON array, or all for every Library:
    ${example({ libraries: '["personal"]', limit: "5" })}
    ${example({ libraries: "all", limit: "5" })}
  When a query has both, libraries wins and library has no effect.

EXAMPLES
  ${example({ filter: 'tags.contains("to-read")', fields: '["title","date.year","creators[0].fullName"]', limit: "20" })}
  ${example({ filter: 'itemType == "journalArticle" && dateAdded >= today() - duration("30 days")', sort: '[{"field":"title","direction":"asc"}]' })}

TOPICS
  ${GUIDE_TOPIC_NAMES.join(", ")}
  Read one topic with obsidian ${ITEM_QUERY_GUIDE_COMMAND} topic=<name>.

SEE ALSO
  obsidian help ${ITEM_QUERY_COMMAND}`;

export function renderGuide(topic: GuideTopic | null): string {
  return topic === null ? QUICKSTART : GUIDE_TOPICS[topic];
}
