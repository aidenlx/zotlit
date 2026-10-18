// What the Reading Card says of an Item's fields: the key facts a researcher
// cites or follows, and "All fields", the other fields the Item has a value
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
  // The keys alone, for the count the closed Annotations row shows.
  "annotations[].indexedKey",
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

/** "30(1)": the volume and the issue. */
function volumeText(values: Values): string {
  const volume = text(values.volume);
  const issue = text(values.issue);
  return `${volume}${issue === "" ? "" : `(${issue})`}`;
}

/** The Venue the facts name, and the base fields it was read from. */
function venueOf(values: Values): { text: string; from: string[] } | null {
  const venue = resolveVenue({
    publicationTitle: text(values.publicationTitle) || null,
    publisher: text(values.publisher) || null,
    volume: null,
    issue: null,
    pages: null,
  });
  if (venue === null) return null;
  const from =
    text(values.publicationTitle) === venue ? "publicationTitle" : "publisher";
  return {
    text: [venue, volumeText(values), text(values.pages)]
      .filter((part) => part !== "")
      .join(", "),
    from: [from, "volume", "issue", "pages"],
  };
}

const WEB = /^https?:\/\//i;

/** The base fields the header and the abstract show, which no list repeats. */
const SHOWN_ELSEWHERE = ["title", "abstractNote"];

/**
 * The key facts: the Venue with volume, issue and pages, the date, the DOI
 * and the URL, the citation key and the date added, each where the Item has
 * one; and the base fields they show.
 */
export function keyFacts(values: Values): {
  facts: CardField[];
  shown: Set<string>;
} {
  const facts: CardField[] = [];
  const shown = new Set(SHOWN_ELSEWHERE);
  const venue = venueOf(values);
  if (venue) {
    facts.push({
      name: "venue",
      label: m.library_view_card_venue(),
      text: venue.text,
    });
    for (const name of venue.from) shown.add(name);
  }
  const add = (name: string, value: string, href?: string) => {
    shown.add(name);
    if (value === "") return;
    facts.push({
      name,
      label: fieldLabel(name),
      text: value,
      ...(href !== undefined && { href }),
    });
  };
  add("date", itemDateText(values.date));
  const doi = text(values.DOI);
  add("DOI", doi, WEB.test(doi) ? doi : `https://doi.org/${doi}`);
  const url = text(values.url);
  // Only a web address links: a `javascript:` URL in Zotero never runs.
  add("url", url, WEB.test(url) ? url : undefined);
  add("citationKey", text(values.citationKey));
  add("dateAdded", timestampText(values.dateAdded));
  return { facts, shown };
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

/** Every creator, by full name. */
function creatorsText(value: QueryViewValue | undefined): string {
  return list(value)
    .flatMap((entry) => {
      const creator = record(entry);
      if (!creator) return [];
      const name =
        text(creator.fullName) ||
        text(creator.literal) ||
        [text(creator.given), text(creator.family)]
          .filter((part) => part !== "")
          .join(" ");
      return name === "" ? [] : [name];
    })
    .join("; ");
}

/**
 * "All fields": the creators, then each field of the Item's type with a
 * value that the header, the abstract and the facts do not show, in
 * Zotero's order, then the date modified.
 */
export function otherFields(
  values: Values,
  shown: ReadonlySet<string>,
): CardField[] {
  const fields: CardField[] = [];
  const add = (name: string, value: string) => {
    if (value !== "")
      fields.push({ name, label: fieldLabel(name), text: value });
  };
  add("creators", creatorsText(values.creators));
  for (const name of typeFields(text(values.itemType))) {
    if (shown.has(name) || shown.has(FIELD_ALIASES[name] ?? name)) continue;
    add(name, fieldText(name, values[name]));
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
