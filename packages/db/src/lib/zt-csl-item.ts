// Forward mapper: a live-database Item -> the CSL-JSON a CSL processor renders.
import { Temporal } from "@zotlit/shared/temporal";
import { FIELD_ALIASES } from "@zotlit/zotero-types";
import {
  CREATOR_TYPE_TO_CSL_NAME,
  CSL_DATE_FIELD_MAP,
  CSL_TEXT_FIELD_CANDIDATES,
  ITEM_TYPE_TO_CSL_TYPE,
} from "@zotlit/zotero-types/csl";

import type { ZoteroUserIdentity } from "@/queries/account";
import type { Creator, Item } from "@/queries/items";

import { parseNameParticles } from "./zt-csl-name";
import type { CslPersonName } from "./zt-csl-name";
import { parseItemDate } from "./zt-date";
import type { ItemDate } from "./zt-date";
import { extraToCsl } from "./zt-extra-to-csl";
import { itemUri } from "./zt-uri";

/** A CSL name variable entry: a structured personal name, or a single literal. */
export type CslName = CslPersonName | { literal: string };

/** A CSL date variable entry: a `date-parts` triple/pair/singleton, or a literal. */
export type CslDate =
  | {
      "date-parts": [[number] | [number, number] | [number, number, number]];
      season?: string;
    }
  | { literal: string };

/**
 * One item as CSL-JSON. Beyond `id` and `type` the variables are open — which
 * ones an item carries depends on its Zotero item type — so they read as
 * `unknown` and narrow to `string`, {@link CslName}`[]`, or {@link CslDate}.
 */
export interface CslItemData {
  /** The item's Zotero Item URI, the identity a CSL processor cites it by. */
  id: string;
  /** CSL item type, e.g. `"article-journal"`. */
  type: string;
  [variable: string]: unknown;
}

/**
 * Zotero maps `place` onto `event-place` (and emits no `publisher-place`) for
 * these types, pending an `eventPlace` data migration.
 *
 * @see https://github.com/zotero/utilities/blob/1dd38e27edf81e9d9c4161c957b7efb7f5681ac3/utilities_item.js#L87
 */
const EVENT_PLACE_ITEM_TYPES: ReadonlySet<string> = new Set([
  "audioRecording",
  "presentation",
  "videoRecording",
]);

/** Zotero keeps only the leading ISBN of a multi-ISBN field in CSL-JSON. */
const FIRST_ISBN_RE = /^(?:97[89]-?)?(?:\d-?){9}[\dx](?!-)\b/i;

/**
 * Convert one {@link Item} into the CSL-JSON a CSL processor consumes: text
 * variables via {@link CSL_TEXT_FIELD_CANDIDATES} (first candidate carrying a
 * value), `type` via {@link ITEM_TYPE_TO_CSL_TYPE}, name variables via
 * {@link CREATOR_TYPE_TO_CSL_NAME}, and date variables via
 * {@link CSL_DATE_FIELD_MAP}. The inverse of `cslToTemplateItem`, which reads
 * the CSL-JSON Zotero embeds in a note back into the zt vocabulary.
 *
 * @param user the account owning the personal library, which names every
 *   personal-library item in its `id`. Read it once per database with
 *   {@link getZoteroIdentity} and pass the same value across a batch.
 *
 * Follows Zotero's `itemToCSLJSON()`, with these deliberate departures:
 *
 * - `id` falls back to the item's Indexed Key when the personal library has
 *   no account id to build an {@link itemUri} from.
 * - An unparseable date becomes a literal of its user text rather than of the
 *   raw multipart string.
 * - A date whose day does not exist in its month (`2015-02-30`) degrades to
 *   year-month, where Zotero keeps the impossible day; {@link parseItemDate}
 *   validates the calendar and Zotero only range-checks.
 *
 * @see https://github.com/zotero/utilities/blob/1dd38e27edf81e9d9c4161c957b7efb7f5681ac3/utilities_item.js#L51
 */
export function itemToCsl(item: Item, user: ZoteroUserIdentity): CslItemData {
  const { itemType } = item.fields;
  const fields = itemFieldValues(item);
  return {
    id: itemUri(item.key, item.groupID, user) ?? item.indexedKey,
    type: cslItemType(itemType),
    ...textVariables(fields, itemType),
    ...nameVariables(item),
    ...dateVariables(fields),
  };
}

function cslItemType(itemType: string): string {
  const cslType = ITEM_TYPE_TO_CSL_TYPE[itemType];
  if (!cslType) throw new Error(`Unexpected Zotero Item type "${itemType}"`);
  return cslType;
}

/**
 * Every non-empty field of the item under both its stored name and its base
 * field name, so a CSL candidate resolves whether it names the base field
 * (`publicationTitle`) or a type-specific one (`conferenceName`). Built-in
 * fields win over a custom field of the same name.
 */
function itemFieldValues(item: Item): ReadonlyMap<string, string> {
  const fields = new Map<string, string>();
  const put = (name: string, value: string | null | undefined): void => {
    if (typeof value === "string" && value !== "" && !fields.has(name))
      fields.set(name, value);
  };
  for (const [name, value] of Object.entries(item.fields)) {
    if (name === "itemType" || typeof value !== "string") continue;
    put(name, value);
    const baseField = FIELD_ALIASES[name];
    if (baseField) put(baseField, value);
  }
  for (const [name, value] of item.customFields) put(name, value);
  return fields;
}

function textVariables(
  fields: ReadonlyMap<string, string>,
  itemType: string,
): Record<string, string> {
  const isEventPlaceType = EVENT_PLACE_ITEM_TYPES.has(itemType);
  const variables: Record<string, string> = {};
  for (const [variable, defaultCandidates] of Object.entries(
    CSL_TEXT_FIELD_CANDIDATES,
  )) {
    // `shortTitle` is a read-only alias of `title-short`; Zotero writes neither
    // twice, and CSL styles only know `title-short`.
    if (variable === "shortTitle") continue;
    if (isEventPlaceType && variable === "publisher-place") continue;
    const candidates =
      isEventPlaceType && variable === "event-place"
        ? ["place"]
        : defaultCandidates;
    for (const field of candidates) {
      const value = fields.get(field);
      if (value === undefined) continue;
      const cslValue = field === "ISBN" ? firstIsbn(value) : value;
      variables[variable] = stripEnclosingQuotes(
        field === "extra" ? extraToCsl(cslValue) : cslValue,
      );
      break;
    }
  }
  return variables;
}

function firstIsbn(value: string): string {
  return FIRST_ISBN_RE.exec(value)?.[0] ?? value;
}

function stripEnclosingQuotes(value: string): string {
  return value.startsWith('"') && value.indexOf('"', 1) === value.length - 1
    ? value.slice(1, -1)
    : value;
}

/**
 * Creators grouped under their CSL name variable, in Zotero's own order. A
 * creator type outside the CSL name mapping still counts as `author` when the
 * item type treats it as primary (e.g. `programmer` on a computer program).
 */
function nameVariables(item: Item): Record<string, CslName[]> {
  const variables: Record<string, CslName[]> = {};
  for (const creator of item.creators) {
    const variable =
      CREATOR_TYPE_TO_CSL_NAME[creator.creatorType] ??
      (creator.creatorType === item.primaryCreatorType ? "author" : null);
    const name = variable && toCslName(creator);
    if (!variable || !name) continue;
    (variables[variable] ??= []).push(name);
  }
  return variables;
}

function toCslName(creator: Creator): CslName | null {
  const { firstName, lastName, fieldMode } = creator;
  if (fieldMode === 1 && lastName && !firstName) return { literal: lastName };
  if (lastName || firstName) {
    const name: CslPersonName = {
      family: lastName ?? "",
      given: firstName ?? "",
    };
    if (name.family && name.given) parseNameParticles(name);
    return name;
  }
  return null;
}

function dateVariables(
  fields: ReadonlyMap<string, string>,
): Record<string, CslDate> {
  const variables: Record<string, CslDate> = {};
  for (const [variable, field] of Object.entries(CSL_DATE_FIELD_MAP)) {
    const raw = fields.get(field);
    const date = parseDateField(
      variable === "accessed" ? localAccessDate(raw) : raw,
    );
    if (date) variables[variable] = toCslDate(date);
  }
  return variables;
}

/** A SQL date with no time part, e.g. Zotero's `accessDate` after a web import. */
const SQL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * {@link parseItemDate} reads Zotero's `YYYY-MM-DD <user text>` multipart form,
 * which a bare SQL date resembles but for the trailing text. Supplying an empty
 * one keeps such a value a date instead of degrading it to free text.
 */
function parseDateField(raw: string | undefined): ItemDate | null {
  return parseItemDate(raw && SQL_DATE_RE.test(raw) ? `${raw} ` : raw);
}

function localAccessDate(raw: string | undefined): string | undefined {
  if (!raw || SQL_DATE_RE.test(raw)) return raw;
  const instant = accessDateInstant(raw);
  return instant
    ?.toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toPlainDate()
    .toString();
}

function accessDateInstant(raw: string): Temporal.Instant | null {
  try {
    return Temporal.Instant.from(
      raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`,
    );
  } catch {
    return null;
  }
}

function toCslDate(date: ItemDate): CslDate {
  if (date.kind === "text") {
    return date.year === null
      ? { literal: date.text }
      : yearDateWithSeason(date);
  }
  if (date.month === null) return yearDateWithSeason(date);
  if (date.day === null) return { "date-parts": [[date.year, date.month]] };
  return { "date-parts": [[date.year, date.month, date.day]] };
}

function yearDateWithSeason(date: ItemDate): CslDate {
  if (date.year === null)
    return { literal: date.kind === "text" ? date.text : date.raw };
  const season = yearOnlySeason(date);
  return season
    ? { "date-parts": [[date.year]], season }
    : { "date-parts": [[date.year]] };
}

function yearOnlySeason(date: ItemDate): string | null {
  if (date.year === null || date.month !== null) return null;
  const text = isMultipartDate(date.raw) ? date.raw.slice(11) : date.raw;
  const season = text
    .split(" ")
    .filter((part) => part !== "" && Number.isNaN(Number(part)))
    .join(" ")
    .trim();
  return season || null;
}

function isMultipartDate(raw: string): boolean {
  return raw[4] === "-" && raw[7] === "-" && raw[10] === " ";
}
