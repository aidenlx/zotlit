// Expression Completion inside the brackets of `vault[...]` and of the custom
// fields' path: the names the host knows, quoted.
import type { SyntaxNode } from "@lezer/common";

import { ranked } from "./expression-options";
import type {
  Caret,
  ExpressionCompletionResult,
  ExpressionVocabulary,
} from "./expression-options";

/**
 * The key of a bracket access the caret is in or right after the `[` of:
 * the path before the `[`, the range the quoted key fills, what is typed of
 * it, and whether the `]` is still to write.
 */
function bracketKeyAt(
  inner: SyntaxNode,
  pos: number,
  source: string,
): {
  path: string;
  from: number;
  to: number;
  query: string;
  closed: boolean;
} | null {
  for (let node: SyntaxNode | null = inner; node; node = node.parent) {
    if (node.name !== "ArrayAccess") continue;
    const open = node.getChild("[");
    const close = node.getChild("]");
    const object = node.firstChild;
    if (!open || !object || open.to > pos || (close && close.from < pos))
      return null;
    const path = source.slice(object.from, object.to).replaceAll(/\s+/g, "");
    const closed = close !== null;
    const key = open.nextSibling;
    if (key?.name === "String" && key.from < pos) {
      const quoted =
        key.to - key.from > 1 && source[key.to - 1] === source[key.from];
      return {
        path,
        from: key.from,
        to: quoted && pos < key.to ? key.to : Math.max(pos, key.to),
        query: source.slice(key.from + 1, Math.min(pos, key.to)),
        closed,
      };
    }
    return source.slice(open.to, pos).trim() === ""
      ? { path, from: pos, to: pos, query: "", closed }
      : null;
  }
  return null;
}

/**
 * The quoted keys offered with the caret inside `vault[...]`, in a filter
 * condition, or inside the brackets of the custom fields' path.
 * @returns Undefined in any other bracket access, which takes an expression.
 */
export function keyCompletions(
  { inner, pos, source }: Caret,
  vocabulary: ExpressionVocabulary,
): ExpressionCompletionResult | null | undefined {
  const key = bracketKeyAt(inner, pos, source);
  if (!key) return undefined;
  const names =
    key.path === "vault"
      ? vocabulary.vault?.map(({ name }) => name)
      : key.path === vocabulary.custom?.path
        ? vocabulary.custom.names
        : undefined;
  if (!names) return undefined;
  const options = ranked(names, key.query, (name) => [name]).map((name) => {
    const quoted = JSON.stringify(name);
    return {
      label: quoted,
      insert: key.closed ? quoted : `${quoted}]`,
      kind: "key" as const,
    };
  });
  return options.length === 0 ? null : { from: key.from, to: key.to, options };
}
