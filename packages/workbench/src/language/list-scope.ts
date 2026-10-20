// The calls of list methods that bind names in their first argument, such as
// `value` and `index` in `tags.filter(…)` and `acc` in `reduce`. The names
// come from the method registry of `@zotlit/item-query`, as the planner binds
// them.
import type { SyntaxNode } from "@lezer/common";

import { METHOD_ENTRIES } from "@zotlit/item-query";

/** What a list method binds in its first argument, by the method's name. */
const BINDS: ReadonlyMap<string, readonly string[]> = new Map(
  METHOD_ENTRIES.flatMap(([, name, method]) =>
    method.scope ? [[name, method.scope] as const] : [],
  ),
);

/** Whether the list method `name` binds names in its first argument. */
export const bindsNames = (name: string): boolean => BINDS.has(name);

/** The list methods whose call takes an initial value after the element expression. */
export const TAKES_INITIAL: ReadonlySet<string> = new Set(
  METHOD_ENTRIES.flatMap(([, name, method]) =>
    method.scope && method.parameters.length > 1 ? [name] : [],
  ),
);

/** The name of the list method that `call` calls and that binds names, or null. */
export function bindingMethod(call: SyntaxNode, source: string): string | null {
  if (call.name !== "Call") return null;
  const callee = call.firstChild;
  const name =
    callee?.name === "ObjectAccess" ? callee.getChild("PropertyName") : null;
  if (!name) return null;
  const method = source.slice(name.from, name.to);
  return BINDS.has(method) ? method : null;
}

/** Whether `pos` is in the first argument of `call`. */
export function inFirstArgument(call: SyntaxNode, pos: number): boolean {
  const open = call.getChild("(");
  const close = call.getChild(")");
  return (
    open !== null &&
    open.to <= pos &&
    (close === null || pos <= close.from) &&
    !call.getChildren(",").some((comma) => comma.to <= pos)
  );
}

/**
 * The names bound at `pos`, innermost call first, each once: the names of
 * each list method whose element expression holds `pos`.
 */
export function boundNamesAt(
  inner: SyntaxNode,
  pos: number,
  source: string,
): readonly string[] {
  const names = new Set<string>();
  for (let node: SyntaxNode | null = inner; node; node = node.parent) {
    const method = bindingMethod(node, source);
    if (method && inFirstArgument(node, pos))
      for (const name of BINDS.get(method)!) names.add(name);
  }
  return [...names];
}
