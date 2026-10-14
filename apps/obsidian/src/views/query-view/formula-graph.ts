// The Formulas of a Query File as a graph: which Formulas a view reads, which
// Formula a failed run names as wrong, which Formulas read it in turn, and
// which condition of the view's filters reads one of them. A Formula
// reference is `formula.<name>` as ZotLit Query resolves it
// (`formulaReferences`), so the same text inside a quoted string reads no
// Formula.
import { formulaReferences } from "@zotlit/item-query";

import type { Diagnostic } from "@/services/item-query/contract";
import type { QueryViewRequest } from "@/services/item-query/query-view";

import { formulaName, locateFilterFault, viewFilter } from "./query-file";
import type { ConditionIssue, QueryFile, QueryFileView } from "./query-file";

/**
 * The Formulas of the file that `fields` and `filter` read, with those the
 * Formulas read in turn, each with its text.
 */
export function readFormulas(
  file: QueryFile,
  fields: readonly string[],
  filter: string | undefined,
): Record<string, string> {
  const defined = file.formulas ?? {};
  const read: Record<string, string> = {};
  const add = (name: string | null) => {
    if (name === null || Object.hasOwn(read, name)) return;
    if (!Object.hasOwn(defined, name)) return;
    read[name] = defined[name]!;
    for (const reference of formulaReferences(read[name])) add(reference.name);
  };
  for (const field of fields) add(formulaName(field));
  if (filter !== undefined)
    for (const reference of formulaReferences(filter)) add(reference.name);
  return read;
}

/**
 * The Formula that a failed run names: the one whose text holds the mistake,
 * or the one that `fields`, the filter or a Formula reads and the request
 * does not define. `null` when the mistake is in no Formula.
 */
export function faultedFormula(
  diagnostic: Diagnostic,
  request: QueryViewRequest,
): string | null {
  const { location } = diagnostic;
  if (location?.argument === "formulas")
    return location.path !== undefined &&
      Object.hasOwn(request.formulas ?? {}, location.path)
      ? location.path
      : null;
  return diagnostic.code === "unknown-formula" ? diagnostic.found : null;
}

/**
 * The Formulas of `formulas` that read the Formula `name`, directly or through
 * another Formula.
 */
export function readersOf(
  formulas: Readonly<Record<string, string>>,
  name: string,
): string[] {
  const readers = new Set<string>();
  const pending = [name];
  for (let target = pending.pop(); target !== undefined; target = pending.pop())
    for (const [reader, text] of Object.entries(formulas)) {
      if (reader === name || readers.has(reader)) continue;
      if (formulaReferences(text).some((entry) => entry.name === target)) {
        readers.add(reader);
        pending.push(reader);
      }
    }
  return [...readers];
}

/**
 * The first condition of the view's filters that reads one of the Formulas in
 * `formulasLeftOut`, with the message of that Formula; `null` when none reads
 * one.
 */
export function formulaCondition(
  file: QueryFile,
  view: QueryFileView,
  formulasLeftOut: Readonly<Record<string, string>>,
): ConditionIssue | null {
  const filter = viewFilter(file, view);
  if (filter === undefined) return null;
  for (const { name, from, to } of formulaReferences(filter)) {
    if (!Object.hasOwn(formulasLeftOut, name)) continue;
    const at = locateFilterFault(file, view, { from, to });
    if (at) return { ...at, message: formulasLeftOut[name]! };
  }
  return null;
}
