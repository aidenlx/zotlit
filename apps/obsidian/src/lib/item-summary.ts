import { parseItemDate } from "@zotlit/db";
import type { Creator, Item } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";

const FALLBACK_CREATOR_TYPES = ["editor", "director", "contributor"] as const;

export type SummaryItem = Pick<Item, "key" | "creators" | "primaryCreatorType">;
export type SummaryItemFields = {
  readonly title?: string | null;
  readonly citationKey?: string | null;
  readonly date?: string | null;
};

export interface ItemSummary {
  title: string;
  subtitle: string;
  formatted: string;
}

export function itemSummary(
  item: SummaryItem,
  fields: SummaryItemFields,
): ItemSummary {
  const creators = creatorSummary(item);
  const date = fields.date ?? null;
  const year = parseItemDate(date)?.year ?? null;
  const title = fields.title ?? fields.citationKey ?? item.key;

  const subtitle = creators
    ? year === null
      ? creators
      : `${creators} (${year})`
    : year === null
      ? ""
      : `(${year})`;
  const formatted = subtitle ? `${subtitle}: ${title}` : title;
  return { title, subtitle, formatted };
}

export function creatorSummary(
  item: Pick<SummaryItem, "creators" | "primaryCreatorType">,
): string {
  for (const creatorType of creatorTypePriority(item.primaryCreatorType)) {
    const creators = item.creators.filter((c) => c.creatorType === creatorType);
    if (creators.length === 0) continue;
    return summarizeCreators(creators);
  }
  return "";
}

function creatorTypePriority(primaryCreatorType: string | null): string[] {
  const priority = primaryCreatorType
    ? [primaryCreatorType, ...FALLBACK_CREATOR_TYPES]
    : FALLBACK_CREATOR_TYPES;
  return [...new Set(priority)];
}

function summarizeCreators(creators: readonly Creator[]): string {
  const first = creators[0]?.lastName ?? "";
  if (!first) return "";

  const second = creators[1]?.lastName ?? "";
  const count =
    creators.length === 1 ? 1 : creators.length === 2 && second ? 2 : 3;
  return m.creator_summary({ count, first, second });
}
