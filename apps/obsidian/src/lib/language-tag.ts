// The language form Pandoc and CSL read, shared by the vault Citation Locale and one document's own Document Language.

/**
 * A language tag as BCP 47 writes one, which is the whole locale form Pandoc
 * and CSL read: the everyday `de`, `pt-BR`, `zh-Hans-CN`; the Unicode extension
 * Pandoc sorts a bibliography by, such as `de-u-co-phonebk`; the extended
 * language and private-use forms, such as `zh-cmn-Hans-CN` and `x-pmr`; and the
 * irregular tags the registry grandfathered in, such as `i-klingon`. The regular
 * grandfathered tags — `art-lojban`, `zh-min-nan` — are ordinary language tags
 * in shape, so the grammar takes them without being told.
 *
 * A tag carries its meaning whichever case it is written in, so `I-KLINGON`
 * and `SGN-BE-FR` are the tags their lowercase spellings are.
 *
 * @see https://www.rfc-editor.org/rfc/rfc5646#section-2.1 — the `Language-Tag` ABNF
 * @see https://www.rfc-editor.org/rfc/rfc5646#section-2.1.1 — case carries no meaning
 */
const LANGUAGE_TAG =
  /^(?:(?:en-GB-oed|i-ami|i-bnn|i-default|i-enochian|i-hak|i-klingon|i-lux|i-mingo|i-navajo|i-pwn|i-tao|i-tay|i-tsu|sgn-BE-FR|sgn-BE-NL|sgn-CH-DE)|x(?:-[A-Za-z0-9]{1,8})+|(?:[A-Za-z]{2,3}(?:-[A-Za-z]{3}){0,3}|[A-Za-z]{4,8})(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|[0-9]{3}))?(?:-(?:[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*(?:-[0-9A-WY-Za-wy-z](?:-[A-Za-z0-9]{2,8})+)*(?:-x(?:-[A-Za-z0-9]{1,8})+)?)$/i;

/**
 * Whether `tag` names a language a CSL processor and a Pandoc writer both read.
 *
 * @see https://github.com/jgm/pandoc/blob/3.10/MANUAL.txt — "Language variables"
 * @see https://docs.citationstyles.org/en/v1.0.2/specification.html#locale-fallback
 */
export function isLanguageTag(tag: string): boolean {
  return LANGUAGE_TAG.test(tag) && noRepeatedSubtags(tag);
}

/** The shape a variant subtag is written in, which is what tells one apart. */
const VARIANT = /^(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3})$/;

/**
 * Whether the tag names each variant and each extension once, which the grammar
 * alone does not say: `de-1901-1901` and `en-u-ca-gregory-u-nu-latn` are shaped
 * like tags and are none.
 *
 * The subtags a private-use sequence carries mean whatever their writer says, so
 * a repeat among them is a repeat of nothing and the sequence ends the reading.
 * Everything after the first single-character subtag belongs to an extension,
 * whose own subtags are two characters or longer, so a single character there
 * opens one; a variant is what the run before it is written in the shape of.
 *
 * @param tag one tag the grammar already took.
 * @see https://www.rfc-editor.org/rfc/rfc5646#section-2.2.9 — what a tag may write twice
 */
function noRepeatedSubtags(tag: string): boolean {
  const subtags = tag.toLowerCase().split("-");
  if (subtags[0] === "x") return true;
  const privateUse = subtags.indexOf("x", 1);
  const named = privateUse === -1 ? subtags : subtags.slice(0, privateUse);
  // The language subtag opens the tag, and can be as long as a variant is.
  const extensions = named.findIndex(
    (subtag, index) => index > 0 && subtag.length === 1,
  );
  const end = extensions === -1 ? named.length : extensions;
  return (
    allDistinct(named.slice(1, end).filter((subtag) => VARIANT.test(subtag))) &&
    allDistinct(named.slice(end).filter((subtag) => subtag.length === 1))
  );
}

function allDistinct(subtags: readonly string[]): boolean {
  return new Set(subtags).size === subtags.length;
}
