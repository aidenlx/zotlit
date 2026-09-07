// Runtime mapping from template Citation Items to the Pandoc Citation Source Module.

import { formatPandocCitation, PandocCitationError } from "./pandoc-citation";
import type { PandocCitationForm, PandocCitationItem } from "./pandoc-citation";

export function formatTemplatePandocCitation(
  value: unknown,
  form: unknown = "normal",
): string {
  if (!Array.isArray(value)) {
    throw new PandocCitationError(
      "invalid-input",
      "pandoc_cite requires a Citation Item array",
      { property: "items" },
    );
  }
  return formatPandocCitation(
    value.map(mapCitationItem),
    form as PandocCitationForm,
  );
}

function mapCitationItem(
  value: unknown,
  itemIndex: number,
): PandocCitationItem {
  const record = asRecord(value);
  const item = asRecord(record?.item);
  const citationKey = item?.citationKey;
  const prefix = record?.prefix;
  const suffix = record?.suffix;
  const locator = record?.locator;
  const labelShort = record?.labelShort;
  const suppressAuthor = record?.suppressAuthor;
  if (
    record === null ||
    item === null ||
    (typeof citationKey !== "string" && citationKey !== null) ||
    (typeof prefix !== "string" && prefix !== null) ||
    (typeof suffix !== "string" && suffix !== null) ||
    (typeof locator !== "string" && locator !== null) ||
    typeof suppressAuthor !== "boolean" ||
    (locator !== null && typeof labelShort !== "string")
  ) {
    throw new PandocCitationError(
      "invalid-input",
      `Citation Item ${itemIndex + 1} has an invalid template-data shape`,
      { itemIndex, property: "items" },
    );
  }
  return {
    citationKey,
    prefix,
    suffix,
    locator:
      locator === null ? null : { label: labelShort as string, value: locator },
    suppressAuthor,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
