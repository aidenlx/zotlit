// The Item Query guide: tiered literal-English text, after the Template
// Workbench guide. Every command and Filter Expression it shows comes from
// `example` or `filter` below, so a test runs each one against a real query.
// Command names, parameters, and defaults come from the constants the
// handlers run.

import { DEFAULT_FIELDS, DEFAULT_SORT } from "@zotlit/item-query";

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

const DEFAULT_FIELD_LIST = listOf(DEFAULT_FIELDS);
/** The default sort in words, such as "dateModified descending". */
const DEFAULT_SORT_TEXT = listOf(
  DEFAULT_SORT.map(
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
  A bare name is a built-in field of the schema (schema.fields[].filter
  gives the type a filter reads). Examples:
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
  sort() orders a list: text in the order of text, then dates, with null
  last; unique() keeps the first of equal elements; reverse() turns the
  list around; slice(start, end) takes a part, and a negative index counts
  from the end; join(separator) writes the elements as one text, a null
  element as empty text; flat() opens one level of nested lists. Each one
  gives a new list and leaves the field as it is.
    ${filter('tags.sort()[0] == "to-read"')}
    ${filter("creators.unique().length == 1")}
    ${filter('tags.slice(0, 2).contains("methods")')}
    ${filter('creators.join("; ").contains("Lovelace; ")')}
    ${filter('[tags, collections].flat().contains("to-read")')}

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
  Read a custom field as custom["<exact name>"]. schema.customFields lists
  each one; its path is ready to use. A custom field whose bareName is true
  also has a short form: its name alone. A bare name always means the
  built-in field when one has that name.

ERRORS AND EMPTY VALUES
  A wrong function name, argument count, or argument type fails the query
  with a diagnostic that points at the text, also inside an if branch.
  A value that is missing or unreadable for one Item is null for that Item.
  null is false in a filter, so !x is true when x is null. This selects the
  Items from 2000 on and the Items without a year:
    ${filter("!(date.year < 2000)")}

SEE ALSO
  schema.functions, schema.methods, and schema.properties list every call
  with its parameters.`;

const FIELDS_SECTION = `FIELDS AND PROJECTION PATHS

DESCRIPTION
  fields is a JSON array of Projection Paths: the values each row returns.
  Without fields, each row has ${DEFAULT_FIELD_LIST}.
  Use fields='[]' to return only the Indexed Keys.
    ${example({ fields: "[]", limit: "all" })}

PATHS
  A path selects a field or a value inside it, as in a ZotLit template:
  date.year, creators[0].fullName, tags[1].name. Each entry of
  schema.fields with projection true is a path. A list path shows index 0;
  any index works.
    ${example({ fields: '["title","date.year","creators[0].fullName","tags","attachments"]' })}
  A custom field is the path custom["<exact name>"]; copy it from
  schema.customFields[].path.

VALUES
  Each row has every requested path. A missing value is null; an empty list
  is []. Timestamps and dates are ISO 8601 text, such as
  2024-06-01T10:00:00Z, 2020-03-15, or 2019-11.`;

const SORT_SECTION = `SORT AND LIMIT

SORT
  sort is a JSON array of {"field","direction"} objects; direction is "asc"
  or "desc". The first entry orders first. A Sortable Field has sort true in
  schema.fields: one value per Item, such as title, date, or dateModified.
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
  Each answer is JSON with contractVersion, command, and ok.
  On success, the query answer has identity (the vault and the Zotero
  source), libraries, request (the query after defaults), returnedCount,
  truncated, and rows. Each row is {"indexedKey","values"}; values has one
  entry for each path in request.fields.
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
  On failure, ok is false and diagnostic holds code, message, and hint.
  Follow diagnostic.hint to correct the query, then run it again.
  diagnostic.location names the argument; index is the position in fields
  or sort; span gives the characters of the filter text, from (inclusive)
  to to (exclusive).
  An invalid query has a code of its own, such as unknown-field. The other
  codes, each with its hint:
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

/** Canonical topic registry shared by parsing, generated help, and the index. */
export const GUIDE_TOPICS = {
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

export function parseGuideTopic(value: string): GuideTopic | null {
  return Object.hasOwn(GUIDE_TOPICS, value) ? (value as GuideTopic) : null;
}

const QUICKSTART = `ZOTLIT ITEM QUERY

Item Query finds Items in your Zotero Libraries and returns the values you
select as JSON. It reads the top-level Items outside the trash and changes
nothing in Zotero.

WORKFLOW
  1. Read the schema: the fields, functions, and defaults of this source.
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
  schema.defaults.libraries names the source of the default Libraries, the
  Library scope setting; it is no value of the libraries argument.

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
