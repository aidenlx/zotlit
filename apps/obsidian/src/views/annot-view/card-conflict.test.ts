import { expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { MutationState } from "@/services/annotation-repository/service";

import { conflictPanel, uncertainCard } from "./card-conflict";

const NOW = Temporal.Instant.from("2026-09-16T15:52:21Z");

it("puts Zotero's colour beside the user's, both by name, with Apply again", () => {
  const panel = conflictPanel({
    write: "color",
    attempted: "#ff6666",
    fresh: "#5fb236",
  });

  expect(panel.values).toEqual([
    { label: m.annot_view_conflict_fresh(), value: m.annot_view_color_green() },
    {
      label: m.annot_view_conflict_attempted(),
      value: m.annot_view_color_red(),
    },
  ]);
  expect(panel.actions.map(({ kind }) => kind)).toEqual([
    "apply-again",
    "discard",
  ]);
  expect(panel.prompt).toBeNull();
});

it("puts the two comments side by side, and names the one Zotero has none of", () => {
  const panel = conflictPanel({
    write: "comment",
    attempted: "Worth citing",
    fresh: null,
  });

  expect(panel.values.map(({ value }) => value)).toEqual([
    m.annot_view_conflict_no_value(),
    "Worth citing",
  ]);
});

it("asks a delete for confirmation against the card, naming no value", () => {
  const panel = conflictPanel({
    write: "delete",
    attempted: null,
    fresh: null,
  });

  expect(panel.values).toEqual([]);
  expect(panel.prompt).toBe(m.annot_view_conflict_delete_prompt());
  expect(panel.actions.map(({ kind }) => kind)).toEqual([
    "delete-anyway",
    "discard",
  ]);
});

it("offers both verbs of an Uncertain Create, and neither while one is in flight", () => {
  const standing = uncertainCard({ kind: "uncertain" }, NOW);
  const sending = uncertainCard({ kind: "pending" }, NOW);

  expect(standing.actions).toEqual([
    { kind: "retry", label: m.annot_view_uncertain_retry(), disabled: false },
    {
      kind: "discard",
      label: m.annot_view_uncertain_discard(),
      disabled: false,
    },
  ]);
  expect(standing.detail).toBe(m.annot_view_uncertain_detail());
  // Pending shows only as disabled verbs.
  expect(sending.actions.map(({ disabled }) => disabled)).toEqual([true, true]);
  expect(sending.detail).toBe(m.annot_view_uncertain_sending());
});

it("says what a refused retry answered, and keeps the verbs live", () => {
  const refused: MutationState = {
    kind: "failed",
    failure: { kind: "denied" },
  };

  const card = uncertainCard(refused, NOW);

  expect(card.detail).toBe(
    `${m.capability_authorization_required()}. ${m.capability_authorization_required_detail()}`,
  );
  expect(card.actions.map(({ disabled }) => disabled)).toEqual([false, false]);
});
