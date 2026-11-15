// `@chenglou/pretext` measures text with a canvas, which the test DOM lacks.
// Here each character takes half the font's size in pixels, and a text
// breaks onto a new line where its next character passes the width, so a
// test can count the lines a text takes at a width and a font. A font with
// no size in pixels gives a text no line. The List's predicted heights in
// Obsidian are checked by the long-list End-to-end Run.
export type PreparedText = { readonly text: string; readonly advance: number };

export function prepare(text: string, font: string): PreparedText {
  const size = font.split(" ").find((part) => part.endsWith("px"));
  return { text, advance: size ? Number.parseFloat(size) / 2 : 0 };
}

export function layout(
  { text, advance }: PreparedText,
  maxWidth: number,
  lineHeight: number,
): { height: number; lineCount: number } {
  const perLine = Math.max(1, Math.floor(maxWidth / advance));
  const lineCount = Math.ceil(text.length / perLine);
  return { height: lineCount * lineHeight, lineCount };
}

export function clearCache(): void {}
