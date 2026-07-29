// Reverse mapper: embedded CSL-JSON item data (as Zotero hoists it onto a note's
// `data-citation-items`) → the narrowed zt cite-item vocabulary.
import {
  CSL_TEXT_FIELD_MAP,
  CSL_TYPE_MAP,
  CREATOR_TYPE_TO_CSL_NAME,
} from "@zotlit/zotero-types/csl";

import {
  textDate,
  tryDate,
  tryYearMonth,
  withToString,
  yearOnly,
  type ItemDate,
} from "@/lib/zt-date";
import { parseItemExtra } from "@/lib/zt-extra";

import { type TemplateCiteItemData } from "./zt-template-cite";
import { type TemplateCreator } from "./zt-template-item";

/**
 * {@link CREATOR_TYPE_TO_CSL_NAME} inverted into CSL variable → Zotero
 * creator type, first-declared-wins on a collision (e.g. both `creator` and
 * `author` map to the CSL `author` variable; `author` is declared first).
 */
const CSL_NAME_VAR_TO_CREATOR_TYPE: ReadonlyMap<string, string> =
  Object.entries(CREATOR_TYPE_TO_CSL_NAME).reduceRight(
    (map, [creatorType, cslNameVar]) => map.set(cslNameVar, creatorType),
    new Map<string, string>(),
  );

/** Every zt field a CSL text variable can resolve to, first-candidate-wins. */
function textFieldsFromCsl(
  csl: Record<string, unknown>,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [cslVar, ztField] of Object.entries(CSL_TEXT_FIELD_MAP)) {
    const value = csl[cslVar];
    if (typeof value === "string" && !(ztField in fields))
      fields[ztField] = value;
  }
  return fields;
}

function cslNameToCreator(name: unknown, role: string): TemplateCreator {
  const { family, given, literal } = (name ?? {}) as {
    family?: unknown;
    given?: unknown;
    literal?: unknown;
  };
  if (typeof literal === "string") {
    return { family: "", given: "", literal, role, fullName: literal };
  }
  const familyName = typeof family === "string" ? family : "";
  const givenName = typeof given === "string" ? given : "";
  return {
    family: familyName,
    given: givenName,
    literal: null,
    role,
    fullName: `${givenName} ${familyName}`.trim(),
  };
}

/** Every CSL name variable present on `csl`, mapped to zt creators in key order. */
function creatorsFromCsl(csl: Record<string, unknown>): TemplateCreator[] {
  const creators: TemplateCreator[] = [];
  for (const [key, value] of Object.entries(csl)) {
    const role = CSL_NAME_VAR_TO_CREATOR_TYPE.get(key);
    if (!role || !Array.isArray(value)) continue;
    for (const name of value) creators.push(cslNameToCreator(name, role));
  }
  return creators;
}

/**
 * Map a CSL `issued` date variable — `date-parts` triple/pair/singleton, or a
 * `literal` string — onto the {@link ItemDate} shape shared with the live-DB
 * leg. An invalid calendar date (e.g. a nonexistent day) degrades to
 * year-month, then to year-only, mirroring {@link parseItemDate}'s cascade.
 */
function cslIssuedToItemDate(issued: unknown): ItemDate | null {
  const date = cslIssuedToItemDateInner(issued);
  return date && withToString(date);
}

function cslIssuedToItemDateInner(issued: unknown): ItemDate | null {
  if (!issued || typeof issued !== "object") return null;
  const { literal, "date-parts": parts } = issued as {
    literal?: unknown;
    "date-parts"?: unknown;
  };
  if (typeof literal === "string") return textDate(literal, literal);
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return null;
  const [year, month, day] = parts[0] as unknown[];
  if (typeof year !== "number") return null;
  if (typeof month === "number" && typeof day === "number") {
    return (
      tryDate({ year, month, day }, `${year}-${month}-${day}`) ??
      tryYearMonth({ year, month }, `${year}-${month}`) ??
      yearOnly(year, String(year))
    );
  }
  if (typeof month === "number")
    return (
      tryYearMonth({ year, month }, `${year}-${month}`) ??
      yearOnly(year, String(year))
    );
  return yearOnly(year, String(year));
}

/**
 * Convert one cited item's embedded CSL-JSON `itemData` into
 * {@link TemplateCiteItemData}: text variables via {@link CSL_TEXT_FIELD_MAP}
 * (first valid candidate), `type` via {@link CSL_TYPE_MAP}, name variables via
 * {@link CSL_NAME_VAR_TO_CREATOR_TYPE}, and `issued` via
 * {@link cslIssuedToItemDate}. `citation-key` maps onto both
 * `citationKey`/`citekey`; a caller resolving a final citekey across legs
 * (e.g. note import) overrides these afterward.
 */
export function cslToTemplateItem(
  csl: Record<string, unknown>,
): TemplateCiteItemData {
  const fields = textFieldsFromCsl(csl);
  const creators = creatorsFromCsl(csl);
  const citationKey = fields.citationKey ?? null;
  return {
    ...fields,
    itemType:
      typeof csl.type === "string" ? (CSL_TYPE_MAP[csl.type] ?? null) : null,
    creators,
    primaryCreatorType: creators[0]?.role ?? null,
    title: fields.title ?? null,
    abstract: fields.abstract ?? null,
    containerTitle: fields.containerTitle ?? null,
    citationKey,
    citekey: citationKey,
    date: cslIssuedToItemDate(csl.issued),
    shortTitle: fields.shortTitle ?? null,
    DOI: fields.DOI ?? null,
    url: fields.url ?? null,
    ISBN: fields.ISBN ?? null,
    ISSN: fields.ISSN ?? null,
    volume: fields.volume ?? null,
    issue: fields.issue ?? null,
    pages: fields.pages ?? null,
    publisher: fields.publisher ?? null,
    place: fields.place ?? null,
    edition: fields.edition ?? null,
    language: fields.language ?? null,
    extra: parseItemExtra(fields.extra),
  };
}
