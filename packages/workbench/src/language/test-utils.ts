// Test-only helpers: a tree walk shared by the Liquid and Eta grammar tests,
// and the document focus the editor tests need. Not reachable from
// src/language/index.ts, so they stay out of the shipped bundle.
import type { Parser } from "@lezer/common";
import { vi } from "vitest";

/**
 * Reports the document as focused until disposed. happy-dom reports a
 * document without focus, which CodeMirror reads as an editor without focus.
 * @returns The hold on the focus; disposing it restores happy-dom's answer.
 */
export function documentFocus(): Disposable {
  const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  return { [Symbol.dispose]: () => hasFocus.mockRestore() };
}

/** Node names along the tree, depth-first, for the slice `[from, to)`. */
export function nodeNames(
  parser: Parser,
  source: string,
  { from = 0, to = source.length }: { from?: number; to?: number } = {},
): string[] {
  const names: string[] = [];
  parser.parse(source).iterate({
    from,
    to,
    enter(node) {
      if (node.from >= from && node.to <= to) names.push(node.name);
    },
  });
  return names;
}
