// Data contract shared by generated Language Packs, the compiler, the runtime
// interpreter, and the dev pack server: the grammar's shapes plus the rules
// every consumer must agree on (the formatter allowlist, the numeric-literal
// predicate selectors are matched against, and the generated-file-name rule).

export type LanguagePack = {
  schemaVersion: 1;
  locale: string;
  messages: Record<string, Message>;
};

export type Message =
  | string
  | {
      declarations: Declaration[];
      variants: Variant[];
    };

export type Declaration =
  | { type: "input"; name: string }
  | { type: "local"; name: string; value: Expression };

export type Expression =
  | { type: "text"; value: string }
  | { type: "variable"; name: string }
  | { type: "literal"; value: string }
  | {
      type: "formatter";
      name: LanguagePackFormatter;
      argument: Expression;
      options: Record<string, Expression>;
    };

export type Variant = {
  matches: Match[];
  pattern: Expression[];
};

export type Match =
  | { type: "literal"; key: string; value: string }
  | { type: "catchall"; key: string };

/** The formatters every Language Pack producer and consumer may name. */
export const LANGUAGE_PACK_FORMATTERS = [
  "plural",
  "number",
  "datetime",
] as const;

export type LanguagePackFormatter = (typeof LANGUAGE_PACK_FORMATTERS)[number];

const formatterNames = new Set<string>(LANGUAGE_PACK_FORMATTERS);

export function isSupportedLanguagePackFormatter(
  name: string,
): name is LanguagePackFormatter {
  return formatterNames.has(name);
}

/** Literal texts a `0[bBoOxX]` prefix or an `Infinity`/`NaN` spelling never parse as numeric. */
const EXCLUDED_NUMERIC_SPELLING = /^(?:0[bBoOxX]|[+-]?Infinity$|NaN$)/;

/**
 * Parses a selector's literal match text as a number, or returns `undefined`
 * if it isn't one. A literal only parses when it round-trips through
 * `Number` with no leading/trailing whitespace, hex/octal/binary/Infinity/NaN
 * spellings, or precision loss from an unsafe integer — the same rule the
 * runtime uses to match a literal against a numeric input, so the compiler's
 * best-effort input typing and the runtime's matching never disagree about
 * which literals are numeric.
 */
export function parseNumericLiteral(text: string): number | undefined {
  if (text.length === 0 || text.trim() !== text) return undefined;
  if (EXCLUDED_NUMERIC_SPELLING.test(text)) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) return undefined;
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) return undefined;
  return value;
}

/** Whether a file name is shaped like a locale pack the compiler emits and the dev pack server serves. */
export function isLanguagePackFileName(name: string): boolean {
  return /^[\w-]+\.json$/.test(name);
}
