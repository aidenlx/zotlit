// The heading an export sets over its bibliography, in the language citeproc
// formats that bibliography in.
//
// Pandoc's citeproc heads a bibliography only when `reference-section-title`
// names a heading, and CSL locales carry no term for one: their `reference`
// term is the countable noun ("Referenzen", "参考"), not a section heading. So
// the export names it, as each language's academic writing usually does.

/** By lowercase language tag, down to the primary language subtag. */
const HEADINGS: Readonly<Record<string, string>> = {
  ar: "المراجع",
  ca: "Referències",
  cs: "Literatura",
  da: "Litteratur",
  de: "Literatur",
  el: "Βιβλιογραφία",
  en: "References",
  es: "Referencias",
  fa: "منابع",
  fi: "Lähteet",
  fr: "Références",
  he: "מקורות",
  hu: "Irodalom",
  id: "Daftar Pustaka",
  it: "Bibliografia",
  ja: "参考文献",
  ko: "참고문헌",
  nb: "Litteratur",
  nl: "Literatuur",
  pl: "Bibliografia",
  pt: "Referências",
  ro: "Bibliografie",
  ru: "Список литературы",
  sv: "Referenser",
  th: "บรรณานุกรม",
  tr: "Kaynakça",
  uk: "Список літератури",
  vi: "Tài liệu tham khảo",
  zh: "参考文献",
  "zh-hant": "參考文獻",
  "zh-hk": "參考文獻",
  "zh-mo": "參考文獻",
  "zh-tw": "參考文獻",
};

/** The language citeproc falls back to, where nothing names one. */
const DEFAULT_LANGUAGE = "en-US";

/**
 * A Lua filter that runs just before citeproc and heads the bibliography in the
 * document's citation language: its `lang`, which is the document's own or the
 * Citation Locale lent for citeproc, and otherwise `styleLocale`.
 *
 * It leaves the heading to the document where the document takes it: a
 * `reference-section-title` of its own, a `refs` div it places the
 * bibliography in, or a closing section heading, which Pandoc itself reads as
 * the bibliography's heading.
 *
 * @param styleLocale `default-locale` of the style the export renders with.
 */
export function bibliographyHeadingFilter(
  styleLocale: string | undefined,
): string {
  return `local HEADINGS = pandoc.json.decode(${luaString(JSON.stringify(HEADINGS))})
local FALLBACK = ${luaString(styleLocale || DEFAULT_LANGUAGE)}

--- The heading for a language tag, matched down to its primary subtag.
local function heading_for(tag)
  local key = tag:lower():gsub("_", "-")
  while key ~= "" do
    if HEADINGS[key] then
      return HEADINGS[key]
    end
    key = key:match("^(.*)%-[^%-]*$") or ""
  end
  return HEADINGS.en
end

local function places_refs(blocks)
  local found = false
  blocks:walk({
    Div = function(div)
      found = found or div.identifier == "refs"
    end,
  })
  return found
end

function Pandoc(doc)
  local meta = doc.meta
  local last = doc.blocks[#doc.blocks]
  if
    meta["reference-section-title"] ~= nil
    or meta["suppress-bibliography"]
    or (last and last.t == "Header")
    or places_refs(doc.blocks)
  then
    return nil
  end
  local tag = meta.lang and pandoc.utils.stringify(meta.lang) or FALLBACK
  meta["reference-section-title"] = pandoc.MetaString(heading_for(tag))
  doc.meta = meta
  return doc
end
`;
}

/** `value` as a Lua string literal, JSON's `\uXXXX` escape spelled Lua's way. */
function luaString(value: string): string {
  return JSON.stringify(value).replaceAll(/\\u([\da-f]{4})/g, "\\u{$1}");
}
