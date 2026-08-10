// Normalize Zotero Extra field syntax for CSL processors.
import {
  CSL_DATE_FIELD_MAP,
  CSL_TEXT_FIELD_CANDIDATES,
} from "@zotlit/zotero-types/csl";

const EXTRA_CSL_FIELDS = new Set([
  "abstract",
  "accessed",
  "annote",
  "archive",
  "archive-place",
  "author",
  "authority",
  "call-number",
  "chapter-number",
  "citation-label",
  "citation-number",
  "collection-editor",
  "collection-number",
  "collection-title",
  "composer",
  "container",
  "container-author",
  "container-title",
  "container-title-short",
  "dimensions",
  "director",
  "edition",
  "editor",
  "editorial-director",
  "event",
  "event-date",
  "event-place",
  "first-reference-note-number",
  "genre",
  "illustrator",
  "interviewer",
  "issue",
  "issued",
  "jurisdiction",
  "keyword",
  "language",
  "locator",
  "medium",
  "note",
  "number",
  "number-of-pages",
  "number-of-volumes",
  "original-author",
  "original-date",
  "original-publisher",
  "original-publisher-place",
  "original-title",
  "page",
  "page-first",
  "publisher",
  "publisher-place",
  "recipient",
  "references",
  "reviewed-author",
  "reviewed-title",
  "scale",
  "section",
  "source",
  "status",
  "submitted",
  "title",
  "title-short",
  "translator",
  "type",
  "version",
  "volume",
  "year-suffix",
]);

const ZOTERO_FIELD_TO_CSL_FIELD = new Map<string, string>([
  ...Object.entries(CSL_TEXT_FIELD_CANDIDATES).flatMap(([variable, fields]) =>
    fields.map((field) => [field, variable] as const),
  ),
  ...Object.entries(CSL_DATE_FIELD_MAP).map(
    ([variable, field]) => [field, variable] as const,
  ),
]);

/**
 * Normalize Extra's citeproc-js cheater syntax before export.
 *
 * @see https://github.com/zotero/utilities/blob/1dd38e27edf81e9d9c4161c957b7efb7f5681ac3/utilities_item.js#L661
 */
export function extraToCsl(extra: string): string {
  return extra
    .split("\n")
    .map((line) => {
      const colon = line.indexOf(":");
      if (colon < 1 || colon === line.length - 1) return line;

      const field = line.slice(0, colon);
      if (!isExtraFieldName(field)) return line;
      return `${extraCslField(field)}${line.slice(colon)}`;
    })
    .join("\n");
}

function isExtraFieldName(value: string): boolean {
  for (const character of value) {
    if (!isExtraFieldCharacter(character)) return false;
  }
  return true;
}

function isExtraFieldCharacter(character: string): boolean {
  return (
    character === " " ||
    character === "-" ||
    (character >= "A" && character <= "Z") ||
    (character >= "a" && character <= "z")
  );
}

function extraCslField(field: string): string {
  const normalized = field.toLowerCase().replaceAll(" ", "-");
  if (normalized === "archive-location") return "archive_location";
  if (["doi", "isbn", "issn", "pmcid", "pmid", "url"].includes(normalized))
    return normalized.toUpperCase();
  if (EXTRA_CSL_FIELDS.has(normalized)) return normalized;

  const zoteroField = toZoteroFieldName(field);
  return ZOTERO_FIELD_TO_CSL_FIELD.get(zoteroField) ?? field;
}

function toZoteroFieldName(field: string): string {
  const spaceBeforeCapital = firstSpaceBeforeCapital(field);
  const joined =
    spaceBeforeCapital === -1
      ? field
      : `${field.slice(0, spaceBeforeCapital)}${field.slice(spaceBeforeCapital + 1)}`;
  return joined[1] === joined[1]?.toLowerCase()
    ? `${joined[0]?.toLowerCase()}${joined.slice(1)}`
    : joined;
}

function firstSpaceBeforeCapital(value: string): number {
  for (let index = 0; index < value.length - 1; index++) {
    const next = value[index + 1] ?? "";
    if (value[index] === " " && next >= "A" && next <= "Z") return index;
  }
  return -1;
}
