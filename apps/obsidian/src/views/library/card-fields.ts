// What the Reading Card says of an Item's fields: its header, as a paper's
// title page reads, and "All fields", the other fields the Item has a value
// for, in the order Zotero shows its type's fields, under Zotero's labels.
//
// @see apps/obsidian/docs/adr/0071-the-library-view-is-a-fileless-query-view-host-that-saves-to-plugin-data.md
import { resolveVenue } from "@zotlit/db";
import { FIELD_ALIASES } from "@zotlit/zotero-types";
import { FIELD_LABELS } from "@zotlit/zotero-types/field-labels";
import { ITEM_TYPES } from "@zotlit/zotero-types/item-types";

import * as m from "@/lib/i18n/generated/messages";
import { runtime } from "@/lib/i18n/generated/runtime";
import type { QueryViewValue } from "@/services/item-query/query-view";
import { holdsPdf } from "@/views/query-view/papers-layout";
import { fieldLabel } from "@/views/query-view/view-properties";

type Values = Readonly<Record<string, QueryViewValue>>;

/** The paths of the card's one read of the Item that are not Zotero fields. */
const OWN_PATHS = [
  "itemType",
  "creators",
  "dateAdded",
  "dateModified",
  "collections",
  "tags",
  "attachments[].indexedKey",
  "attachments[].title",
  "attachments[].fileType",
  "notes",
  // The keys and colours alone, for the counts "Your annotations" shows.
  "annotations[].indexedKey",
  "annotations[].color",
] as const;

/**
 * The paths the card reads: every Zotero field, since the type of the Item
 * is not known before the read, and the lists of its other parts.
 */
export const CARD_PATHS: readonly string[] = [
  ...new Set([...Object.keys(FIELD_LABELS["en-US"]), ...OWN_PATHS]),
];

/** A fact, or a field under "All fields". */
export interface CardField {
  /** The fact's name, or the Zotero field's. */
  readonly name: string;
  readonly label: string;
  readonly text: string;
  /** Where the value links, for a DOI or a URL. */
  readonly href?: string;
}

export function text(value: QueryViewValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function list(
  value: QueryViewValue | undefined,
): readonly QueryViewValue[] {
  return Array.isArray(value) ? value : [];
}

export function record(value: QueryViewValue | undefined): Values | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Values)
    : null;
}

const locale = () => runtime.getLocale();

/**
 * A Zotero date as the researcher wrote it, at its precision: a day, a month,
 * a year, or the text where it does not parse.
 */
function itemDateText(value: QueryViewValue | undefined): string {
  const date = record(value);
  if (!date) return text(value);
  const own = text(date.text);
  if (own !== "") return own;
  const { year, month, day } = date;
  if (typeof year !== "number") return "";
  if (typeof month !== "number") return String(year);
  const at = Temporal.PlainDate.from({
    year,
    month,
    day: typeof day === "number" ? day : 1,
  });
  return at.toLocaleString(locale(), {
    year: "numeric",
    month: "long",
    ...(typeof day === "number" && { day: "numeric" }),
  });
}

/** A timestamp, or a calendar day, as a date in the researcher's time zone. */
function timestampText(value: QueryViewValue | undefined): string {
  const raw = text(value);
  if (raw === "") return "";
  try {
    const at = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? Temporal.PlainDate.from(raw)
      : Temporal.Instant.from(raw);
    return at.toLocaleString(locale(), { dateStyle: "long" });
  } catch {
    return raw;
  }
}

/** The text of the Zotero field `name`. */
function fieldText(name: string, value: QueryViewValue | undefined): string {
  if (name === "accessDate" || name === "dateAdded" || name === "dateModified")
    return timestampText(value);
  return record(value) ? itemDateText(value) : text(value);
}

/** Whether Zotero's type `type` has the base field `name`, under its own name or an alias. */
function typeHas(type: string, name: string): boolean {
  return typeFields(type).some(
    (field) => field === name || FIELD_ALIASES[field] === name,
  );
}

/**
 * The value of the base field `name` where the Item's type has it: a value
 * left in a field of another type, after a change of type, is not the Item's.
 */
function ownText(values: Values, name: string): string {
  return typeHas(text(values.itemType), name) ? text(values[name]) : "";
}

/** "30(1)": the volume and the issue. */
function volumeText(values: Values): string {
  const volume = ownText(values, "volume");
  const issue = ownText(values, "issue");
  return `${volume}${issue === "" ? "" : `(${issue})`}`;
}

/** The Venue the header names, and the base field it was read from. */
function venueOf(values: Values): { text: string; from: string } | null {
  const venue = resolveVenue({
    publicationTitle: text(values.publicationTitle) || null,
    publisher: text(values.publisher) || null,
    volume: null,
    issue: null,
    pages: null,
  });
  if (venue === null) return null;
  return {
    text: venue,
    from:
      text(values.publicationTitle) === venue
        ? "publicationTitle"
        : "publisher",
  };
}

function yearOf(values: Values): string {
  const year = record(values.date)?.year;
  return typeof year === "number" ? String(year) : "";
}

const WEB = /^https?:\/\//i;

/** The most creators the header names before "et al.". */
export const CREATOR_CAP = 10;

/** A creator's full name. */
function creatorName(creator: Values): string {
  return (
    text(creator.fullName) ||
    text(creator.literal) ||
    [text(creator.given), text(creator.family)]
      .filter((part) => part !== "")
      .join(" ")
  );
}

function creatorsOf(value: QueryViewValue | undefined): Values[] {
  return list(value).flatMap((entry) => {
    const creator = record(entry);
    return creator ? [creator] : [];
  });
}

/**
 * The header of the Item, as its title page reads: the title, the creators
 * in full, and the Venue with volume, issue, pages and year; the DOI and the
 * citation key. The list row reads the same paths, so the card shows the
 * same header from the row while it reads the rest.
 */
export interface CardHeader {
  readonly title: string;
  readonly itemType: string;
  /** The label of the Item type; `null` for a type this build does not know. */
  readonly type: string | null;
  /**
   * The creators of the first one's role, by full name, as the row names the
   * authors and not the editors; "et al." past {@link CREATOR_CAP}.
   */
  readonly creators: string;
  /** "Venue, 30(1), 5998–6008 · 2017"; empty for none. */
  readonly venue: string;
  readonly doi: { readonly text: string; readonly href: string } | null;
  readonly citationKey: string | null;
  /** Whether the Item has a PDF, which the card's primary button opens. */
  readonly pdf: boolean;
}

/** The base fields the header and the abstract show, which All fields leaves out. */
const SHOWN_ELSEWHERE = [
  "title",
  "abstractNote",
  "volume",
  "issue",
  "pages",
  "DOI",
  "citationKey",
  "dateAdded",
];

export function cardHeader(values: Values): CardHeader {
  const creators = creatorsOf(values.creators);
  const role = creators[0]?.role;
  const names = creators
    .filter((creator) => creator.role === role)
    .map(creatorName)
    .filter((name) => name !== "");
  const shownNames = names.slice(0, CREATOR_CAP).join(", ");
  const venue = venueOf(values);
  const source = [venue?.text ?? "", volumeText(values), text(values.pages)]
    .filter((part) => part !== "")
    .join(", ");
  const doi = text(values.DOI);
  const citationKey = text(values.citationKey);
  const itemType = text(values.itemType);
  return {
    title: text(values.title),
    itemType,
    type: itemTypeLabel(itemType),
    creators:
      names.length > CREATOR_CAP
        ? m.query_view_papers_more_creators({ names: shownNames })
        : shownNames,
    venue: [source, yearOf(values)].filter((part) => part !== "").join(" · "),
    doi:
      doi === ""
        ? null
        : { text: doi, href: WEB.test(doi) ? doi : `https://doi.org/${doi}` },
    citationKey: citationKey === "" ? null : citationKey,
    pdf: holdsPdf(values),
  };
}

/** The date the Item was added, in the researcher's time zone; `null` for none. */
export function addedText(values: Values): string | null {
  return timestampText(values.dateAdded) || null;
}

/**
 * The base fields the header shows, which "All fields" leaves out: the
 * Venue's, and the date where the header's year says all of it.
 */
function shownInHeader(values: Values): Set<string> {
  const shown = new Set(SHOWN_ELSEWHERE);
  const venue = venueOf(values);
  if (venue) shown.add(venue.from);
  const date = record(values.date);
  if (!date || typeof date.month !== "number") shown.add("date");
  return shown;
}

/** The fields of the item type `type`, in Zotero's order. */
function typeFields(type: string): readonly string[] {
  const own = ITEM_TYPES.find((entry) => entry.name === type)?.fields;
  if (own) return own;
  // A type this build does not know: its base fields, which name each
  // value once.
  return Object.keys(FIELD_LABELS["en-US"]).filter(
    (name) => !(name in FIELD_ALIASES),
  );
}

/**
 * "All fields": the creators where the header does not name them all, then
 * each field of the Item's type with a value that the header and the
 * abstract do not show, in Zotero's order, then the date modified. A URL
 * links where it is a web address: a `javascript:` URL in Zotero never runs.
 */
export function otherFields(values: Values): CardField[] {
  const shown = shownInHeader(values);
  const fields: CardField[] = [];
  const add = (name: string, value: string, href?: string) => {
    if (value !== "")
      fields.push({
        name,
        label: fieldLabel(name),
        text: value,
        ...(href !== undefined && { href }),
      });
  };
  const creators = creatorsOf(values.creators);
  const role = creators[0]?.role;
  if (
    creators.length > CREATOR_CAP ||
    creators.some((creator) => creator.role !== role)
  )
    add(
      "creators",
      creators
        .map(creatorName)
        .filter((name) => name !== "")
        .join("; "),
    );
  for (const name of typeFields(text(values.itemType))) {
    if (shown.has(name) || shown.has(FIELD_ALIASES[name] ?? name)) continue;
    const value = fieldText(name, values[name]);
    add(name, value, name === "url" && WEB.test(value) ? value : undefined);
  }
  add("dateModified", fieldText("dateModified", values.dateModified));
  return fields;
}

/** The label of the item type `type`; `null` for a type this build does not know. */
export function itemTypeLabel(type: string): string | null {
  const entry = ITEM_TYPES.find((each) => each.name === type);
  if (!entry) return null;
  return entry.labels[locale() === "zh-CN" ? "zh-CN" : "en-US"];
}
