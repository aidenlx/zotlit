/**
 * Checks that generated prose reads as text in MDX, which parses `{` and `<`
 * as expression and element openers outside code spans.
 * @param text The prose, which may hold Markdown code spans.
 * @param source What the prose is, for the error message.
 * @returns `text` unchanged.
 * @throws When `text` carries `{`, `}`, or `<` outside a code span.
 */
export function plainMdxText(text: string, source: string): string {
  const opener = /[{}<]/.exec(text.replaceAll(/`[^`]*`/g, ""));
  if (opener) {
    throw new Error(
      `${source} carries the MDX opener ${opener[0]} outside a code span: ${text}`,
    );
  }
  return text;
}
