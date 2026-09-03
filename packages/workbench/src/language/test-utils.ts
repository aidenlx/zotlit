// Test-only tree-walking helper shared by the Liquid and Eta grammar tests.
// Not reachable from src/language/index.ts, so it stays out of the shipped bundle.
import type { Parser } from "@lezer/common";

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
