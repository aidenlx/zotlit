// How much room Chinese text takes beside Latin text.

/** A Han character, or CJK punctuation and full-width forms. */
export const cjkGlyph = /[\p{Script=Han}　-〿＀-￯]/u;

/** A string's width in Latin glyphs: a CJK glyph or full-width mark counts two. */
export function textWidth(text: string): number {
  let width = 0;
  for (const glyph of text) width += cjkGlyph.test(glyph) ? 2 : 1;
  return width;
}
