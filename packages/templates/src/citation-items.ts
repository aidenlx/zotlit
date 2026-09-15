// The Citation Item shape every citation source form reads, and its two boundary checks.

/** A Locator as a citation source module receives it: a label and its value. */
export interface CitationLocator {
  readonly label: string;
  readonly value: string;
}

/**
 * One Citation Item, narrowed onto the properties a citation source module
 * reads. Each source form renders these same properties into its own syntax.
 */
export interface CitationItemInput {
  readonly citationKey: string | null;
  readonly prefix: string | null;
  readonly suffix: string | null;
  readonly locator: CitationLocator | null;
  readonly suppressAuthor: boolean;
}

/** Builds a source module's own error, so each filter reports in its own type. */
export type InvalidCitationItems = (
  message: string,
  itemIndex: number | null,
) => Error;

/**
 * Narrow a template's `zt.citations` value onto {@link CitationItemInput}s.
 * Template data reaches a filter untyped, so this is the one boundary check
 * between a template and the citation source modules.
 *
 * @param filterName the filter this runs for, which names it in the array error.
 * @throws whatever `invalid` returns, for a non-array or a malformed item.
 */
export function mapCitationItems(
  value: unknown,
  filterName: string,
  invalid: InvalidCitationItems,
): CitationItemInput[] {
  if (!Array.isArray(value)) {
    throw invalid(`${filterName} requires a Citation Item array`, null);
  }
  return value.map((entry, itemIndex) => mapItem(entry, itemIndex, invalid));
}

/**
 * Check already-narrowed Citation Items, for a serializer called directly
 * rather than through {@link mapCitationItems}.
 *
 * @throws whatever `invalid` returns, for a non-array or a malformed item.
 */
export function assertCitationItems(
  items: readonly CitationItemInput[],
  invalid: InvalidCitationItems,
): void {
  if (!Array.isArray(items)) {
    throw invalid("Citation Items must be an array", null);
  }
  for (const [itemIndex, item] of items.entries()) {
    if (
      typeof item !== "object" ||
      item === null ||
      (typeof item.citationKey !== "string" && item.citationKey !== null) ||
      (typeof item.prefix !== "string" && item.prefix !== null) ||
      (typeof item.suffix !== "string" && item.suffix !== null) ||
      typeof item.suppressAuthor !== "boolean" ||
      !isLocator(item.locator)
    ) {
      throw invalid(
        `Citation Item ${itemIndex + 1} has an invalid shape`,
        itemIndex,
      );
    }
  }
}

function isLocator(value: unknown): value is CitationLocator | null {
  if (value === null) return true;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { label?: unknown }).label === "string" &&
    typeof (value as { value?: unknown }).value === "string"
  );
}

function mapItem(
  value: unknown,
  itemIndex: number,
  invalid: InvalidCitationItems,
): CitationItemInput {
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
    throw invalid(
      `Citation Item ${itemIndex + 1} has an invalid template-data shape`,
      itemIndex,
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
