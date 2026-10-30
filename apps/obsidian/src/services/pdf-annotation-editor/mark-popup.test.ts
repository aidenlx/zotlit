import { describe, expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import { IDLE } from "@/services/annotation-repository/write";
import type { MutationState } from "@/services/annotation-repository/write";
import { capabilityBlocks } from "@/views/annot-view/card-controls";

import { annotation } from "./__fixtures__";
import { markPopupRow } from "./mark-popup";
import type { MarkPopupRow } from "./mark-popup";

const NOW = Temporal.Instant.from("2026-09-17T10:00:00Z");

const HIGHLIGHT: AnnotationRecord = {
  ...annotation("PUPR5FG5", "highlight", {
    pageIndex: 0,
    rects: [[265.833, 611.202, 374.503, 620.019]],
  }),
  text: "a quoted sentence",
};

function row(
  overrides: {
    annotation?: AnnotationRecord;
    capability?: EditingCapability;
    mutation?: MutationState;
    stack?: { index: number; total: number };
    tagging?: boolean;
  } = {},
): MarkPopupRow {
  return markPopupRow({
    annotation: overrides.annotation ?? HIGHLIGHT,
    blocks: capabilityBlocks(overrides.capability ?? { kind: "writable" }, NOW),
    mutation: overrides.mutation ?? IDLE,
    stack: overrides.stack ?? { index: 0, total: 1 },
    tagging: overrides.tagging ?? false,
    now: NOW,
  });
}

/** Each verb, as its id beside whether it runs and what its tooltip says. */
function verbs(
  built: MarkPopupRow,
): Partial<Record<string, [boolean, string]>> {
  return Object.fromEntries(
    built.verbs.map((verb) => [verb.id, [verb.disabled, verb.tooltip]]),
  );
}

describe("markPopupRow", () => {
  it("draws one row of verbs: colour, tags, copy, delete, reveal", () => {
    expect(row().verbs.map(({ id, icon }) => [id, icon])).toEqual([
      ["color", "palette"],
      ["tags", "tag"],
      ["copy", "copy"],
      ["delete", "trash-2"],
      ["reveal", "panel-right-open"],
    ]);
  });

  it("offers the comment field live, and wears the Annotation's colour", () => {
    expect(row().comment).toMatchObject({ disabled: false, blocked: null });
    expect(row().color).toBe("#2ea8e5");
  });

  it("says which tag verb it is, and presses it while the tag editor is open", () => {
    const tagged = { ...HIGHLIGHT, tags: ["to read"] };
    const tagVerb = (built: MarkPopupRow) =>
      built.verbs.find(({ id }) => id === "tags");
    expect(tagVerb(row())).toEqual({
      id: "tags",
      icon: "tag",
      pressed: false,
      tooltip: m.annot_view_card_add_tags(),
      disabled: false,
    });
    expect(tagVerb(row({ annotation: tagged, tagging: true }))).toMatchObject({
      tooltip: m.annot_view_card_edit_tags(),
      pressed: true,
    });
  });

  it("keeps the tag verb live while a tag session's save is in flight", () => {
    const built = row({
      mutation: { kind: "pending", write: "tags", session: true },
    });
    expect(verbs(built).tags).toEqual([false, m.annot_view_card_add_tags()]);
  });

  it("stands the writes down under a block, and says why in each", () => {
    const built = row({
      capability: { kind: "read-only", reason: "library-read-only" },
    });
    const reason = "You do not have write access to this library.";
    expect(verbs(built)).toEqual({
      color: [true, reason],
      tags: [true, reason],
      copy: [false, "Copy annotation text"],
      delete: [true, reason],
      reveal: [false, "Reveal in the annotation view"],
    });
    // The comment field keeps its press and rests as text, as on the card:
    // its press states the reason.
    expect(built.comment).toMatchObject({
      disabled: false,
      blocked: { reason },
    });
  });

  it("stands them down while a write of its own is in flight", () => {
    const built = row({ mutation: { kind: "pending", write: "color" } });
    expect(verbs(built).delete).toEqual([true, "Saving to Zotero…"]);
    expect(verbs(built).tags).toEqual([true, m.annot_view_card_saving()]);
    expect(built.comment).toMatchObject({ disabled: true, blocked: null });
  });

  it("keeps copying off a mark that carries no text and no comment", () => {
    const image = { ...HIGHLIGHT, text: null, comment: null };
    expect(verbs(row({ annotation: image })).copy?.[0]).toBe(true);
  });

  it("offers copying on a mark that carries only a comment", () => {
    const note = { ...HIGHLIGHT, text: null, comment: "Check the axis" };
    expect(verbs(row({ annotation: note })).copy?.[0]).toBe(false);
  });

  it("offers the stepper only where marks overlap, counting from one", () => {
    expect(row().stepper).toBeNull();
    expect(row({ stack: { index: 1, total: 3 } }).stepper).toEqual({
      tooltip: "Next mark here (2 of 3)",
      text: "2/3",
    });
  });
});
