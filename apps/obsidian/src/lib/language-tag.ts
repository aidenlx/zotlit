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
 * @see https://www.rfc-editor.org/rfc/rfc5646#section-2.1 — the `Language-Tag` ABNF
 */
const LANGUAGE_TAG =
  /^(?:(?:en-GB-oed|i-ami|i-bnn|i-default|i-enochian|i-hak|i-klingon|i-lux|i-mingo|i-navajo|i-pwn|i-tao|i-tay|i-tsu|sgn-BE-FR|sgn-BE-NL|sgn-CH-DE)|x(?:-[A-Za-z0-9]{1,8})+|(?:[A-Za-z]{2,3}(?:-[A-Za-z]{3}){0,3}|[A-Za-z]{4,8})(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|[0-9]{3}))?(?:-(?:[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*(?:-[0-9A-WY-Za-wy-z](?:-[A-Za-z0-9]{2,8})+)*(?:-x(?:-[A-Za-z0-9]{1,8})+)?)$/;

/**
 * Whether `tag` names a language a CSL processor and a Pandoc writer both read.
 *
 * @see https://github.com/jgm/pandoc/blob/3.10/MANUAL.txt — "Language variables"
 * @see https://docs.citationstyles.org/en/v1.0.2/specification.html#locale-fallback
 */
export function isLanguageTag(tag: string): boolean {
  return LANGUAGE_TAG.test(tag);
}
