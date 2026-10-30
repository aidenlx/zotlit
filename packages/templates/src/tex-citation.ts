// Complete formatting for the LaTeX and BibLaTeX citation command source form.

import { assertCitationItems } from "./citation-items";
import type { CitationItemInput, CitationLocator } from "./citation-items";

/** A TeX control word, optionally starred: `cite`, `autocite`, `autocite*`. */
const CONTROL_WORD = /^[A-Za-z]+\*?$/u;

/**
 * Characters that end or re-scope `\command{...}` before the key list does.
 * `_`, `:`, `-`, and `.` stay legal, since Better BibTeX's own key styles use
 * them and LaTeX never typesets a key it only writes to the `.aux` file.
 */
const UNSAFE_KEY = /[\s,\\{}%#~$^&]/u;

/**
 * An unescaped `%` comments out the rest of the line, which would swallow the
 * command's own closing brace without any error. Every other TeX special in an
 * affix fails loudly at compile time, so this is the one that has to be caught
 * here.
 */
const UNESCAPED_COMMENT = /(?<!\\)%/u;

export type TexCitationErrorCode =
  | "invalid-input"
  | "unrepresentable-value"
  | "unsafe-affix";

export type TexCitationProperty =
  | "items"
  | "command"
  | "citationKey"
  | "prefix"
  | "suffix"
  | "locator"
  | "suppressAuthor";

export class TexCitationError extends Error {
  readonly code: TexCitationErrorCode;
  readonly itemIndex: number | null;
  readonly property: TexCitationProperty;

  constructor(
    code: TexCitationErrorCode,
    message: string,
    {
      itemIndex = null,
      property,
      cause,
    }: {
      itemIndex?: number | null;
      property: TexCitationProperty;
      cause?: unknown;
    },
  ) {
    super(message, { cause });
    this.name = "TexCitationError";
    this.code = code;
    this.itemIndex = itemIndex;
    this.property = property;
  }
}

/** The affix parts one optional argument carries, in postnote order. */
const AFFIX_PARTS = [
  ["prefix", (item: CitationItemInput) => item.prefix],
  ["locator", (item: CitationItemInput) => locatorText(item.locator)],
  ["suffix", (item: CitationItemInput) => item.suffix],
] as const satisfies readonly (readonly [
  TexCitationProperty,
  (item: CitationItemInput) => string | null,
])[];

/**
 * Format Citation Items as one LaTeX citation command. Every retained item
 * joins a single key list, and the first retained item's Citation Prefix and
 * Locator/Citation Suffix become the command's prenote and postnote — the only
 * two slots the source form has, which is why a later item carrying either one
 * is unrepresentable rather than silently dropped.
 *
 * An affix reaches LaTeX as source, so `\emph{see}` renders as emphasis. Only
 * what would change the command's own structure is rejected or encoded.
 *
 * Note that the two-optional-argument form the prenote needs is BibLaTeX's and
 * natbib's, not the LaTeX kernel's single-argument `\cite`.
 *
 * @param items Citation Items in source order. Items with a null key are omitted.
 * @param command the control word to cite with, without its backslash, e.g.
 *   `cite` for LaTeX or `autocite` for BibLaTeX.
 * @returns one complete citation command, or an empty string when no keyed
 *   item remains.
 * @throws {TexCitationError} for invalid input, a value LaTeX cannot carry, or
 *   an affix that would change the command's structure.
 */
export function formatTexCitation(
  items: readonly CitationItemInput[],
  command = "cite",
): string {
  if (!CONTROL_WORD.test(command)) {
    throw new TexCitationError(
      "invalid-input",
      `LaTeX citation command must be a control word, optionally starred: ${JSON.stringify(command)}`,
      { property: "command" },
    );
  }
  assertCitationItems(
    items,
    (message, itemIndex) =>
      new TexCitationError("invalid-input", message, {
        itemIndex,
        property: "items",
      }),
  );
  const keyed = items.flatMap((item, itemIndex) =>
    item.citationKey === null ? [] : [{ item, itemIndex }],
  );
  if (keyed.length === 0) return "";

  for (const { item, itemIndex } of keyed) {
    assertKey(item.citationKey!, itemIndex);
    if (item.suppressAuthor) {
      throw unrepresentable(
        "LaTeX has no general Suppress Author form",
        "suppressAuthor",
        itemIndex,
      );
    }
  }
  for (const { item, itemIndex } of keyed.slice(1)) {
    for (const [property, read] of AFFIX_PARTS) {
      if (read(item) !== null) {
        throw unrepresentable(
          `a LaTeX citation command carries one prenote and one postnote, so only the first retained Citation Item may hold a ${property}`,
          property,
          itemIndex,
        );
      }
    }
  }

  const first = keyed[0]!;
  for (const [property, read] of AFFIX_PARTS) {
    assertSafeAffix(read(first.item), property, first.itemIndex);
  }
  const prenote = protect((first.item.prefix ?? "").trim());
  const postnote = protect(
    `${locatorText(first.item.locator) ?? ""}${first.item.suffix ?? ""}`.trim(),
  );
  const keys = keyed.map(({ item }) => item.citationKey).join(",");
  const notes =
    prenote === ""
      ? postnote === ""
        ? ""
        : `[${postnote}]`
      : `[${prenote}][${postnote}]`;
  return `\\${command}${notes}{${keys}}`;
}

function locatorText(locator: CitationLocator | null): string | null {
  return locator === null ? null : `${locator.label} ${locator.value}`;
}

function assertKey(citationKey: string, itemIndex: number): void {
  if (citationKey !== "" && !UNSAFE_KEY.test(citationKey)) return;
  throw unrepresentable(
    `LaTeX cannot carry the citation key ${JSON.stringify(citationKey)}`,
    "citationKey",
    itemIndex,
  );
}

function unrepresentable(
  reason: string,
  property: TexCitationProperty,
  itemIndex: number,
): TexCitationError {
  return new TexCitationError(
    "unrepresentable-value",
    `Citation Item ${itemIndex + 1}: ${reason}`,
    { itemIndex, property },
  );
}

/**
 * An optional argument ends at the first `]` outside a group, so an affix whose
 * braces do not balance would move that boundary wherever {@link protect} hides
 * a bracket. An unescaped `%` would hide the boundary outright.
 */
function assertSafeAffix(
  value: string | null,
  property: TexCitationProperty,
  itemIndex: number,
): void {
  if (value === null) return;
  const reason = !balanced(value)
    ? "braces that do not balance"
    : UNESCAPED_COMMENT.test(value)
      ? "an unescaped % that would comment out the citation"
      : null;
  if (reason === null) return;
  throw new TexCitationError(
    "unsafe-affix",
    `Citation Item ${itemIndex + 1} has a ${property} with ${reason}`,
    { itemIndex, property },
  );
}

/** Whether every group in TeX source opens and closes; `\{` is a literal brace. */
function balanced(value: string): boolean {
  let depth = 0;
  let escaped = false;
  for (const char of value) {
    if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && (depth -= 1) < 0) return false;
  }
  return depth === 0;
}

/**
 * Hide each `]` in a group so it cannot end the optional argument. An escaped
 * `\]` is one control symbol the argument scanner already reads past.
 */
function protect(value: string): string {
  return value.replaceAll(/(?<!\\)\]/gu, "{]}");
}
