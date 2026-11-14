// `@chenglou/pretext` measures text with a canvas, which the test DOM lacks:
// every text takes no line here, and a List row the height of one line.
// The List's predicted heights are checked in Obsidian, by the long-list
// End-to-end Run.
export type PreparedText = { readonly text: string };

export function prepare(text: string): PreparedText {
  return { text };
}

export function layout(): { height: number; lineCount: number } {
  return { height: 0, lineCount: 0 };
}

export function clearCache(): void {}
