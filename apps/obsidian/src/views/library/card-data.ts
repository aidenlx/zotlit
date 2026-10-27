// Pure Reading Card data: row previews, bibliographic fields and annotation quotes.
import { ANNOTATION_COLORS } from "@/lib/annotation-colors";
import * as m from "@/lib/i18n/generated/messages";
import type { QueryViewValue } from "@/services/item-query/query-view";

import {
  addedText,
  cardHeader,
  list,
  otherFields,
  record,
  text,
} from "./card-fields";
import type { CardField, CardHeader } from "./card-fields";
export type Values = Readonly<Record<string, QueryViewValue>>;

/** One file of the Item. */
export interface CardFile {
  readonly key: string;
  readonly title: string;
  readonly fileType: string;
}

/** One Zotero note of the Item. */
export interface CardNote {
  readonly key: string;
  readonly title: string;
}

/** One colour of the Item's Annotations, and how many have it. */
export interface CardColour {
  /** The colour as Zotero stores it, in lower case. */
  readonly color: string;
  readonly count: number;
}

/** One of the first Annotations, as the preview quotes it. */
export interface CardQuote {
  readonly key: string;
  readonly color: string;
  /**
   * `quote`: highlighted text; `note`: a comment alone; `image`: an area or
   * a drawing, which has no text to quote, named "Image" or "Drawing".
   */
  readonly kind: "quote" | "note" | "image";
  readonly text: string;
  readonly page: string;
}

/** The Item as the card shows it. */
export interface CardItem extends CardHeader {
  fields: readonly CardField[];
  abstract: string | null;
  /** Each place the Item sits, as Library › Collection names. */
  where: readonly (readonly string[])[];
  tags: readonly string[];
  files: readonly CardFile[];
  notes: readonly CardNote[];
  added: string | null;
  annotations: number;
  colours: readonly CardColour[];
  /** The first two Annotations, in the order the cards show them. */
  quotes: readonly CardQuote[];
}

/** How many Annotations the preview quotes. */
export const QUOTED = 2;

/** The paths of an Annotation that the preview quotes. */
export const QUOTE_PATHS = [
  "type",
  "text",
  "comment",
  "color",
  "pageLabel",
] as const;

export function quoteOf(key: string, values: Values): CardQuote {
  const type = text(values.type);
  const quoted = text(values.text);
  const comment = text(values.comment);
  const kind =
    type === "image" || type === "ink"
      ? "image"
      : quoted === "" && comment !== ""
        ? "note"
        : "quote";
  return {
    key,
    color: text(values.color).toLowerCase(),
    kind,
    text:
      kind === "image"
        ? type === "ink"
          ? m.library_view_card_annotation_ink()
          : m.library_view_card_annotation_image()
        : kind === "note"
          ? comment
          : quoted,
    page: text(values.pageLabel),
  };
}

/** The colours of the Item's Annotations, in the order of Zotero's palette. */
function coloursOf(values: Values): CardColour[] {
  const counts = new Map<string, number>();
  for (const value of list(values["annotations[].color"])) {
    const color = text(value).toLowerCase();
    if (color !== "") counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  const place = (color: string) => {
    const at = ANNOTATION_COLORS.indexOf(color);
    return at === -1 ? ANNOTATION_COLORS.length : at;
  };
  return [...counts]
    .map(([color, count]) => ({ color, count }))
    .toSorted((a, b) => place(a.color) - place(b.color));
}

/** The header of the Item as its list row reads it, while the card reads the rest. */
export function previewItem(values: Values): CardItem {
  return {
    ...cardHeader(values),
    fields: [],
    abstract: null,
    where: [],
    tags: [],
    files: [],
    notes: [],
    added: null,
    annotations: 0,
    colours: [],
    quotes: [],
  };
}

export function cardItem(
  values: Values,
  library: string | null,
  quotes: readonly CardQuote[],
): CardItem {
  const abstract = text(values.abstractNote);
  const paths = list(values.collections).flatMap((path) =>
    typeof path === "string" && path !== "" ? [path.split("/")] : [],
  );
  const lead = library === null ? [] : [library];
  const keys = list(values["attachments[].indexedKey"]);
  const titles = list(values["attachments[].title"]);
  const kinds = list(values["attachments[].fileType"]);
  return {
    ...cardHeader(values),
    fields: otherFields(values),
    abstract: abstract === "" ? null : abstract,
    where:
      paths.length > 0
        ? paths.map((path) => [...lead, ...path])
        : lead.length > 0
          ? [lead]
          : [],
    tags: list(values.tags).flatMap((tag) => {
      const name = text(record(tag)?.name);
      return name === "" ? [] : [name];
    }),
    files: keys.flatMap((key, index) =>
      typeof key === "string"
        ? [
            {
              key,
              title: text(titles[index]) || key,
              fileType: text(kinds[index]),
            },
          ]
        : [],
    ),
    notes: list(values.notes).flatMap((entry) => {
      const note = record(entry);
      const key = text(note?.indexedKey);
      return key === "" ? [] : [{ key, title: text(note?.title) || key }];
    }),
    added: addedText(values),
    annotations: list(values["annotations[].indexedKey"]).length,
    colours: coloursOf(values),
    quotes,
  };
}
