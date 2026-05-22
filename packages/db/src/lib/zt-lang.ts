/**
 * Parser for Zotero's `language` field. Ported from
 * `Zotero.Utilities.Item.languageToISO6391`, reshaped to return a
 * discriminated union instead of an opaque string so callers can tell
 * parsed shapes apart from unrecognized text.
 *
 * Zotero stores the field as the user's free-form input verbatim — no
 * normalization on write. Observed shapes in a single real library:
 * ISO 639-1 codes in any case (`en`, `EN`, `En`), ISO 639-2/3 codes (`eng`,
 * `ENG`), English names (`English`, `english`, `ENGLISH`), BCP 47 with
 * region or script (`en-US`, `zh-Hant`), underscore-separated (`en_US`),
 * and outright junk (`New York`, `English.`).
 *
 * Name lookup is caller-provided: `packages/db` never reads the host locale.
 * `createLanguageLookup()` indexes English names, endonyms, and an optional
 * caller UI locale.
 *
 * @see https://github.com/zotero/zotero/blob/3d2f51eeb4e26f0c7b40716d611a6a781e5c2c68/chrome/content/zotero/xpcom/utilities/utilities_item.js#L780 upstream `languageToISO6391`
 */

import { regex } from "arkregex";

/**
 * - `iso6391` — `Intl.Locale` canonicalized the input to a bare 2-letter
 *   language subtag, or a language name lookup hit. On V8 this also covers
 *   ISO 639-2/3 inputs that have a 639-1 equivalent (`eng` → `en`); other
 *   runtimes may instead surface them as `locale`.
 * - `locale`  — syntactically valid BCP 47 `tag` that is *not* a bare 639-1
 *   code: region (`en-US`), script (`zh-Hant`), 5-8 letter reserved primary
 *   subtags, or anything recovered by `_` → `-` substitution
 *   (`en_US` → `en-US`). `tag` is the canonicalized form from `Intl.Locale`,
 *   so syntactically valid but semantically unknown inputs like `foobar`
 *   land here rather than `text`.
 * - `text`    — failed both lookups: not a known language name and not a
 *   syntactically valid `Intl.Locale` even after `_` → `-` substitution
 *   (e.g. `New York`, `English.`). Preserved verbatim.
 *
 * `raw` is always the verbatim stored value, retained for round-tripping.
 */
export type ItemLanguage =
  | { kind: "iso6391"; code: string; raw: string }
  | { kind: "locale"; tag: string; raw: string }
  | { kind: "text"; raw: string };

export type LanguageNameLookup = (input: string) => string | null;

/**
 * Builds the display-name map eagerly so per-item parsing only normalizes and
 * reads the returned map.
 *
 * @param uiLocale UI locale to index, or `null` to skip caller-localized names.
 */
export function createLanguageLookup(
  uiLocale: string | null,
): LanguageNameLookup {
  const map = new Map<string, string>();
  const englishNames = new Intl.DisplayNames("en", { type: "language" });
  const uiNames = createSupportedDisplayNames(uiLocale);

  for (const code of ISO_639_1_CODES) {
    addDisplayName(map, englishNames, code);

    const selfNames = new Intl.DisplayNames(code, { type: "language" });
    addDisplayName(map, selfNames, code);

    if (uiNames) addDisplayName(map, uiNames, code);
  }

  return (input) => map.get(normalize(input)) ?? null;
}

export function parseItemLanguage(
  raw: string | null | undefined,
  lookup: LanguageNameLookup | null,
): ItemLanguage | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fromName = lookup?.(trimmed) ?? null;
  if (fromName) return { kind: "iso6391", code: fromName, raw };

  const tag = tryLocale(trimmed) ?? tryLocale(trimmed.replaceAll("_", "-"));
  if (tag) {
    return ISO_639_1_RE.test(tag)
      ? { kind: "iso6391", code: tag, raw }
      : { kind: "locale", tag, raw };
  }

  return { kind: "text", raw };
}

export function formatItemLanguage(
  lang: ItemLanguage | null | undefined,
): string {
  if (!lang) return "";
  switch (lang.kind) {
    case "iso6391":
      return lang.code;
    case "locale":
      return lang.tag;
    case "text":
      return lang.raw;
  }
}

const ISO_639_1_RE = regex("^[a-z]{2}$");
const DIACRITIC_RE = regex("\\p{Diacritic}", "gu");

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(DIACRITIC_RE, "");
}

function tryLocale(s: string): string | null {
  try {
    return new Intl.Locale(s).toString();
  } catch {
    return null;
  }
}

function createSupportedDisplayNames(
  locale: string | null,
): Intl.DisplayNames | null {
  if (locale === null) return null;
  let supported: string[];
  try {
    supported = Intl.DisplayNames.supportedLocalesOf([locale]);
  } catch {
    return null;
  }
  const [supportedLocale] = supported;
  return supportedLocale
    ? new Intl.DisplayNames(supportedLocale, { type: "language" })
    : null;
}

function addDisplayName(
  map: Map<string, string>,
  names: Intl.DisplayNames,
  code: string,
): void {
  const name = names.of(code);
  if (name) map.set(normalize(name), code);
}

const ISO_639_1_CODES = [
  "ab",
  "aa",
  "af",
  "ak",
  "sq",
  "am",
  "ar",
  "an",
  "hy",
  "as",
  "av",
  "ae",
  "ay",
  "az",
  "bm",
  "ba",
  "eu",
  "be",
  "bn",
  "bi",
  "bs",
  "br",
  "bg",
  "my",
  "ca",
  "ch",
  "ce",
  "ny",
  "zh",
  "cu",
  "cv",
  "kw",
  "co",
  "cr",
  "hr",
  "cs",
  "da",
  "dv",
  "nl",
  "dz",
  "en",
  "eo",
  "et",
  "ee",
  "fo",
  "fj",
  "fi",
  "fr",
  "fy",
  "ff",
  "gd",
  "gl",
  "lg",
  "ka",
  "de",
  "el",
  "kl",
  "gn",
  "gu",
  "ht",
  "ha",
  "he",
  "hz",
  "hi",
  "ho",
  "hu",
  "is",
  "io",
  "ig",
  "id",
  "ia",
  "ie",
  "iu",
  "ik",
  "ga",
  "it",
  "ja",
  "jv",
  "kn",
  "kr",
  "ks",
  "kk",
  "km",
  "ki",
  "rw",
  "ky",
  "kv",
  "kg",
  "ko",
  "kj",
  "ku",
  "lo",
  "la",
  "lv",
  "li",
  "ln",
  "lt",
  "lu",
  "lb",
  "mk",
  "mg",
  "ms",
  "ml",
  "mt",
  "gv",
  "mi",
  "mr",
  "mh",
  "mn",
  "na",
  "nv",
  "nd",
  "nr",
  "ng",
  "ne",
  "no",
  "nb",
  "nn",
  "ii",
  "oc",
  "oj",
  "or",
  "om",
  "os",
  "pi",
  "ps",
  "fa",
  "pl",
  "pt",
  "pa",
  "qu",
  "ro",
  "rm",
  "rn",
  "ru",
  "se",
  "sm",
  "sg",
  "sa",
  "sc",
  "sr",
  "sn",
  "sd",
  "si",
  "sk",
  "sl",
  "so",
  "st",
  "es",
  "su",
  "sw",
  "ss",
  "sv",
  "tl",
  "ty",
  "tg",
  "ta",
  "tt",
  "te",
  "th",
  "bo",
  "ti",
  "to",
  "ts",
  "tn",
  "tr",
  "tk",
  "tw",
  "ug",
  "uk",
  "ur",
  "uz",
  "ve",
  "vi",
  "vo",
  "wa",
  "cy",
  "wo",
  "xh",
  "yi",
  "yo",
  "za",
  "zu",
];
