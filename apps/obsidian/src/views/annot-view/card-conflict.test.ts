import { expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import { conflictPanel } from "./card-conflict";

it("names a text field's two verbs for that field", () => {
  const labels = (write: "color" | "comment" | "text") =>
    conflictPanel({ write, attempted: "mine", fresh: "theirs" }).actions.map(
      ({ kind, label }) => [kind, label],
    );

  expect(labels("comment")).toEqual([
    ["apply-again", m.annot_view_conflict_use_comment()],
    ["discard", m.annot_view_conflict_keep_zotero_comment()],
  ]);
  expect(labels("text")).toEqual([
    ["apply-again", m.annot_view_conflict_use_text()],
    ["discard", m.annot_view_conflict_keep_zotero_text()],
  ]);
  // A write with no text of its own keeps the generic verbs.
  expect(labels("color")).toEqual([
    ["apply-again", m.annot_view_conflict_apply_again()],
    ["discard", m.annot_view_conflict_discard()],
  ]);
});
