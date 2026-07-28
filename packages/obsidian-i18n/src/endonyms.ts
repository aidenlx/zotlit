// Obsidian's closed set of display languages, each mapped to its Endonym.
// Copy that names a Language Pack's language reads this table instead of
// restating per-locale display names or deriving them at runtime.

const OBSIDIAN_LANGUAGE_ENDONYMS: Readonly<Record<string, string>> = {
  am: "አማርኛ",
  ar: "اَلْعَرَبِيَّةُ",
  be: "беларуская мова",
  bn: "বাংলা",
  ca: "català",
  cs: "čeština",
  da: "Dansk",
  de: "Deutsch",
  en: "English",
  "en-GB": "English (GB)",
  es: "Español",
  fa: "فارسی",
  fi: "suomi",
  fr: "Français",
  ga: "Gaeilge",
  he: "עברית",
  hu: "Magyar",
  id: "Bahasa Indonesia",
  it: "Italiano",
  ja: "日本語",
  ka: "ქართული",
  kh: "ខ្មែរ",
  ko: "한국어",
  lv: "Latviešu",
  ms: "Bahasa Melayu",
  ne: "नेपाली",
  nl: "Nederlands",
  no: "Norsk",
  pl: "Polski",
  pt: "Português",
  "pt-BR": "Português do Brasil",
  ro: "Română",
  ru: "Pусский",
  sk: "Slovenčina",
  sq: "Shqip",
  sr: "српски језик",
  sv: "Svenska",
  th: "ไทย",
  tr: "Türkçe",
  uk: "Українська",
  uz: "oʻzbekcha",
  vi: "Tiếng Việt",
  zh: "简体中文",
  "zh-TW": "繁體中文",
};

/**
 * The Endonym for an Obsidian display-language code, or `undefined` for a code
 * outside Obsidian's set. Callers name what to show instead — the Language
 * Pack Lifecycle falls back to the resolved locale code.
 */
export function languageEndonym(language: string): string | undefined {
  return OBSIDIAN_LANGUAGE_ENDONYMS[language];
}
