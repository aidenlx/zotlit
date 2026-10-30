// A filter that reads a record of `this` with none bound shows where to get
// one: on a surface that binds the record, how to give it one; elsewhere,
// the surface that binds it.
import { expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import { contextHint } from "./context-hint";
import type { ContextSource } from "./context-hint";
import type { ReaderDiagnosticSource } from "./reader-diagnostic";

/** The engine's diagnostic for a filter that reads `at` with nothing bound. */
function unbound(at: string, code = "unbound-context"): ReaderDiagnosticSource {
  return {
    code,
    message: `The filter reads ${at}, but the query binds nothing to this.`,
    hint: "Bind it when you run the query.",
    excerpt: { before: "item == ", at, after: "" },
  };
}

it.each<[string, ContextSource | undefined, () => string]>([
  ["this.item", undefined, m.query_view_context_hint_item],
  ["this.attachment", undefined, m.query_view_context_hint_attachment],
  ["this.item", "note", m.query_view_context_hint_note_item],
  ["this.attachment", "note", m.query_view_context_hint_attachment],
  ["this.item", "sidebar", m.query_view_context_hint_sidebar_item],
  ["this.attachment", "sidebar", m.query_view_context_hint_sidebar_attachment],
  ["this . item", undefined, m.query_view_context_hint_item],
])("suggests where %s gets a record on the %s surface", (at, source, hint) => {
  expect(contextHint(unbound(at), source)).toBe(hint());
});

it("suggests nothing for another diagnostic, or for this read whole", () => {
  expect(
    contextHint(unbound("this.item", "invalid-filter"), "note"),
  ).toBeNull();
  expect(contextHint(unbound("this"), undefined)).toBeNull();
  expect(contextHint(unbound("this.item.title"), undefined)).toBeNull();
  expect(
    contextHint({ code: "unbound-context", message: "", hint: "" }, undefined),
  ).toBeNull();
});
