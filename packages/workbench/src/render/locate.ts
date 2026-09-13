import { findNodeAtLocation, getNodeValue, parseTree } from "jsonc-parser";
import type { Node } from "jsonc-parser";

import type { RenderCallerSource } from "./attribution";
import type { RenderDiagnostic } from "./result";

// Retained repair targets are re-read against the source the reader edits now.
import { templateCalls } from "#/document/regions";
// The operator names JSON-e answers to, which say whether a `$` key is one.
import { jsonOperators } from "#/language/json-e-catalog";

/** Re-finds a verified call, keeping the missing-partial first-call exception. */
export function currentCallSite(
  diagnostic: RenderDiagnostic,
  caller: RenderCallerSource,
): RenderDiagnostic["callSite"] {
  const site = diagnostic.sourceSite;
  if (site !== undefined) {
    const offset = caller.source.indexOf(site.source);
    if (offset < 0 || caller.source.indexOf(site.source, offset + 1) !== -1)
      return undefined;
    return {
      from: offset + site.from - site.offset,
      to: offset + site.to - site.offset,
    };
  }
  if (diagnostic.callSite === undefined) return undefined;
  const target =
    diagnostic.code === "missing-partial"
      ? diagnostic.params?.name
      : diagnostic.engine?.template;
  if (target === undefined) return undefined;
  const calls = templateCalls(
    caller.source,
    { from: 0, to: caller.source.length },
    caller.language,
  ).filter(({ name }) => name === String(target));
  return diagnostic.code === "missing-partial" || calls.length === 1
    ? calls[0]?.call
    : undefined;
}

/**
 * The text one entry failure points at, as offsets into the expression the
 * reader edits now. The engine named a place inside the value it ran, and this
 * finds that place again in the current text: a JSON-e rule by walking its
 * keys and indexes, a Liquid expression by the text the token covered. Either
 * way the place has to still hold what the attempt read there, so a repaired
 * or rewritten expression carries no mark, and an unfound place stays unmarked
 * rather than moving the mark somewhere it never was.
 */
export function currentEntrySite(
  diagnostic: RenderDiagnostic,
  expression: string,
): { from: number; to: number } | undefined {
  const site = diagnostic.entrySite;
  if (site === undefined) return undefined;
  if (site.kind === "span") {
    const offset = expression.indexOf(site.source);
    if (offset < 0 || expression.indexOf(site.source, offset + 1) !== -1)
      return undefined;
    return { from: offset + site.from, to: offset + site.to };
  }
  const root = parseTree(expression, [], {
    disallowComments: true,
    allowTrailingComma: false,
  });
  const found = root && findNodeAtLocation(root, [...site.path]);
  if (found === undefined) return undefined;
  // A repaired rule keeps the shape the attempt failed on, so the path alone
  // would go on marking text that has since been corrected. The mark stands
  // only where that place still holds what the attempt read there.
  if (JSON.stringify(getNodeValue(found)) !== site.source) return undefined;
  const node = operatorFault(found) ?? found;
  return { from: node.offset, to: node.offset + node.length };
}

/**
 * The part of a one-operator rule the failure is about, where the rule itself
 * says which part that is. A `$` key JSON-e knows no operator for is what it
 * refused, so the key is the fault. An operator it does know, written over a
 * single expression, ran that expression and nothing else, so the expression
 * is the fault.
 *
 * Anything else keeps the whole node. An operator over a list or a mapping has
 * parts this cannot tell apart, and one missing the clauses it needs — a
 * `$let` with no `in` — failed on what the rule does not say rather than on
 * what it does.
 */
function operatorFault(node: Node): Node | undefined {
  if (node.type !== "object" || node.children?.length !== 1) return undefined;
  const [property] = node.children;
  const [key, value] = property?.children ?? [];
  if (typeof key?.value !== "string" || !/^\$[a-zA-Z]/.test(key.value)) {
    return undefined;
  }
  if (!(key.value in jsonOperators)) return key;
  return value?.type === "string" ? value : undefined;
}
