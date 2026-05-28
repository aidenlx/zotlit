import { type IndexedCreator, type ItemLanguage } from "@zotlit/db";

/**
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/citeproc.js#L705
 */
// oxlint-disable no-misleading-character-class
const ROMANESQUE_REGEXP =
  /[-0-9a-zA-Z\u0e01-\u0e5b\u00c0-\u017f\u0370-\u03ff\u0400-\u052f\u0590-\u05d4\u05d6-\u05ff\u1f00-\u1fff\u0600-\u06ff\u200c\u200d\u200e\u0218\u0219\u021a\u021b\u202a-\u202e]/;
// oxlint-enable no-misleading-character-class

export function formatCreator(
  creator: IndexedCreator | null | undefined,
  language?: ItemLanguage | null,
): string {
  if (!creator) return "";
  const family = creator.lastName ?? "";
  if (creator.fieldMode === 1) return family;

  const given = creator.firstName ?? "";
  if (!ROMANESQUE_REGEXP.test(family.replaceAll('"', ""))) {
    return [family, given].filter(Boolean).join("");
  }

  return isCjkNameOrder(language)
    ? [family, given].filter(Boolean).join(" ")
    : [given, family].filter(Boolean).join(" ");
}

function isCjkNameOrder(language: ItemLanguage | null | undefined): boolean {
  const code = bareLangCode(language);
  return code === "ja" || code === "zh";
}

function bareLangCode(
  language: ItemLanguage | null | undefined,
): string | null {
  if (!language) return null;
  switch (language.kind) {
    case "iso6391":
      return language.code;
    case "locale":
      return language.tag.slice(0, 2);
    case "text":
      return null;
  }
}
