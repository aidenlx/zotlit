// The Item Query guide: tiered literal-English text, after the Template
// Workbench guide. Every command and Filter Expression it shows comes from
// `example` or `filter` below, so a test runs each one against a real query.

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
  return ["obsidian zotlit:item-query", ...parts].join(" ");
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
  key is the Zotero Key of the Item inside the Target Library:
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
  A Collection is its full path from the top-level Collection, joined by /.
  within matches that Collection and every Collection below it:
    ${filter('collections.contains("Thesis/Methods")')}
    ${filter('collections.within("Thesis")')}
  A Creator is the full name, given name first:
    ${filter('creators.contains("Ada Lovelace")')}

DATES
  date and the other Zotero date fields are calendar dates at the precision
  the Item gives: a year, a month, or a day. dateAdded and dateModified are
  timestamps. Calendar days follow the time zone of this computer.
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
  null is false in a filter.

SEE ALSO
  schema.functions, schema.methods, and schema.properties list every call
  with its parameters.`;

const FIELDS_SECTION = `FIELDS AND PROJECTION PATHS

DESCRIPTION
  fields is a JSON array of Projection Paths: the values each row returns.
  Omit fields for itemType, title, creators, date, and dateModified.
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
  The default is dateModified, newest first.
  Items without a value come last in both directions. The Indexed Key orders
  Items that tie on every entry.

ORDER OF TEXT
  Text sorts in one alphabetical order on every computer: digits before
  letters, digit by digit (10 before 9), then case and accents as tie-breaks
  (eclair, Éclair, Zebra).

ORDER OF DATES
  A date sorts as its first possible day: 2020 sorts as 1 January 2020.
  A date without a year comes last.

LIMIT
  limit is the most rows to return: a positive integer, or all for every
  match. The default is 100. truncated is true when more Items match.
    ${example({ sort: '[{"field":"title","direction":"asc"}]', limit: "all" })}`;

const RESULTS_SECTION = `RESULTS AND DIAGNOSTICS

ENVELOPE
  Each answer is JSON with contractVersion, command, and ok.
  On success, the query answer has identity (the vault and the Zotero
  source), library, request (the query after defaults), returnedCount,
  truncated, and rows. Each row is {"indexedKey","values"}; values has one
  entry for each path in request.fields.
  library is {"type":"personal"} or {"type":"group","groupID","name"}.

DIAGNOSTICS
  On failure, ok is false and diagnostic holds code, message, and hint.
  Follow diagnostic.hint to correct the query, then run it again.
  diagnostic.location names the argument; index is the position in fields
  or sort; span gives the characters of the filter text, from (inclusive)
  to to (exclusive).
  unsupported-database-layout means this ZotLit version cannot read the
  Zotero database: ask the user to update ZotLit.`;

/** Canonical topic registry shared by parsing, generated help, and the index. */
export const GUIDE_TOPICS = {
  filter: FILTER_SECTION,
  fields: FIELDS_SECTION,
  sort: SORT_SECTION,
  results: RESULTS_SECTION,
} as const satisfies Record<string, string>;

export type GuideTopic = keyof typeof GUIDE_TOPICS;
export const GUIDE_TOPIC_NAMES = Object.keys(
  GUIDE_TOPICS,
) as readonly GuideTopic[];

export function parseGuideTopic(value: string): GuideTopic | null {
  return Object.hasOwn(GUIDE_TOPICS, value) ? (value as GuideTopic) : null;
}

const QUICKSTART = `ZOTLIT ITEM QUERY

Item Query finds Items in one Zotero Library and returns the values you
select as JSON. It reads the top-level Items outside the trash and changes
nothing in Zotero.

WORKFLOW
  1. Read the schema: the fields, functions, and defaults of this source.
  2. Run a query with filter, fields, sort, and limit.
  3. On ok false, follow diagnostic.hint and run the query again.

SYNOPSIS
  obsidian zotlit:item-query-schema
  obsidian zotlit:item-query [filter=<expression>] [fields=<json>]
    [sort=<json>] [limit=<n|all>] [library=<personal|group:groupID>]
  obsidian zotlit:item-query-guide [topic=<${GUIDE_TOPIC_NAMES.join("|")}>]

DEFAULTS
  Without arguments, a query returns the 100 most recently modified Items of
  My Library with itemType, title, creators, date, and dateModified.
  library=group:<groupID> reads a group Library; the group ID is the number
  in the group's address on zotero.org.

EXAMPLES
  ${example({ filter: 'tags.contains("to-read")', fields: '["title","date.year","creators[0].fullName"]', limit: "20" })}
  ${example({ filter: 'itemType == "journalArticle" && dateAdded >= today() - duration("30 days")', sort: '[{"field":"title","direction":"asc"}]' })}

TOPICS
  ${GUIDE_TOPIC_NAMES.join(", ")}
  Read one topic with obsidian zotlit:item-query-guide topic=<name>.

SEE ALSO
  obsidian help zotlit:item-query`;

export function renderGuide(topic: GuideTopic | null): string {
  return topic === null ? QUICKSTART : GUIDE_TOPICS[topic];
}
