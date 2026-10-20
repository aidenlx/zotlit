// What the Query View suggests when a filter reads a record of `this` that the
// run binds nothing to. The host says only which surface it is; the members
// each surface can bind, and where a member gets its record otherwise, live
// here, so no host writes the hint.
import type { ContextRecord } from "@zotlit/item-query";

import * as m from "@/lib/i18n/generated/messages";

import type { ReaderDiagnosticSource } from "./reader-diagnostic";

/** A record of the Query Context, as a filter reads it from `this`. */
export type ContextMember = ContextRecord;

/**
 * The surface a host is, by what it binds to `this`: a note's embed or block
 * binds the note's Item, the annotation view in the sidebar the Item and the
 * Attachment it follows. A Query File's own tab binds nothing.
 */
export type ContextSource = "note" | "sidebar";

/** The members each surface binds, with the hint where it has none now. */
const BOUND: Record<
  ContextSource,
  Partial<Record<ContextMember, () => string>>
> = {
  note: { item: m.query_view_context_hint_note_item },
  sidebar: {
    item: m.query_view_context_hint_sidebar_item,
    attachment: m.query_view_context_hint_sidebar_attachment,
  },
};

const RECORDS: Record<ContextSource, readonly ContextMember[]> = {
  note: Object.keys(BOUND.note) as ContextMember[],
  sidebar: Object.keys(BOUND.sidebar) as ContextMember[],
};
// One list, so a memo keyed on it holds across renders.
const UNBOUND: readonly ContextMember[] = [];

/** The records a host that is `source` binds to `this`; none in a Query File's own tab. */
export const boundRecords = (
  source: ContextSource | undefined,
): readonly ContextMember[] =>
  source === undefined ? UNBOUND : RECORDS[source];

/** Where a member gets its record, for a surface that cannot bind it. */
const ELSEWHERE: Record<ContextMember, () => string> = {
  item: m.query_view_context_hint_item,
  attachment: m.query_view_context_hint_attachment,
};

/**
 * The suggestion for a run that failed since `this` has no record to read,
 * on a host that is `source`; `null` for another diagnostic, or for a
 * filter that reads `this` itself rather than one of its records.
 */
export function contextHint(
  diagnostic: ReaderDiagnosticSource,
  source: ContextSource | undefined,
): string | null {
  if (diagnostic.code !== "unbound-context") return null;
  const member = memberAt(diagnostic.excerpt?.at);
  if (member === null) return null;
  const bound = source === undefined ? undefined : BOUND[source][member];
  return (bound ?? ELSEWHERE[member])();
}

/** The member that `this.<member>`, the text the fault spans, reads. */
function memberAt(at: string | undefined): ContextMember | null {
  const [head, member, ...rest] = (at ?? "").split(".").map((s) => s.trim());
  if (head !== "this" || rest.length > 0) return null;
  return member === "item" || member === "attachment" ? member : null;
}
