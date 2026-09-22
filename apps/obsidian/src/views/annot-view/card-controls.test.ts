import { expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityCopy } from "@/services/annotation-repository/capability-copy";
import type { CommentDraft } from "@/services/annotation-repository/service";
import type { MutationState } from "@/services/annotation-repository/write";

import {
  cardControls,
  commentIcon,
  commentLabel,
  commentEditorControls,
} from "./card-controls";
import type { CardControls } from "./card-controls";

const NOW = Temporal.Instant.from("2026-09-16T15:52:21Z");

/** Both grant lifetimes enable mutation controls. */
const LIVE: EditingCapability[] = [
  { kind: "writable" },
  { kind: "writable", oneTime: true },
];

/** Every other capability, each with a reason a surface can show in place. */
const BLOCKED: EditingCapability[] = [
  { kind: "authorization-required" },
  { kind: "authorizing" },
  { kind: "cooldown", retryAfter: NOW.add({ seconds: 30 }) },
  ...(
    [
      "zotero-unavailable",
      "local-api-disabled",
      "incompatible-zotero",
      "invalid-response",
      "server-changed",
      "library-read-only",
      "probing",
    ] as const
  ).map((reason): EditingCapability => ({ kind: "read-only", reason })),
];

function controlsOf(
  capability: EditingCapability,
  mutation: MutationState = { kind: "idle" },
): CardControls {
  return cardControls({ capability, mutation, hasComment: false, now: NOW });
}

function states(controls: CardControls): boolean[] {
  return [controls.color, controls.comment, controls.delete].map(
    ({ disabled }) => disabled,
  );
}

function tooltips(controls: CardControls): string[] {
  return [controls.color, controls.comment, controls.delete].map(
    ({ tooltip }) => tooltip,
  );
}

it("keeps every verb live where a gesture reaches Zotero, each naming itself", () => {
  for (const capability of LIVE) {
    const controls = controlsOf(capability);

    expect(states(controls)).toEqual([false, false, false]);
    // Three verbs, three names: a live control's tooltip is what it does.
    expect(new Set(tooltips(controls)).size).toBe(3);
    expect(tooltips(controls).every((text) => text.length > 0)).toBe(true);
  }
});

it("disables every verb in place, carrying the capability's own reason", () => {
  for (const capability of BLOCKED) {
    const controls = controlsOf(capability);
    const copy = editingCapabilityCopy(capability, NOW);
    const reason = copy.detail ?? copy.label;

    expect(states(controls)).toEqual([true, true, true]);
    expect(tooltips(controls)).toEqual([reason, reason, reason]);
  }
});

it("shows a write in flight as disabled verbs, whatever the capability says", () => {
  const pending = controlsOf({ kind: "writable" }, { kind: "pending" });
  const idle = controlsOf({ kind: "writable" });

  expect(states(pending)).toEqual([true, true, true]);
  // One reason, and it is the write rather than the capability.
  expect(new Set(tooltips(pending)).size).toBe(1);
  expect(tooltips(pending)[0]).not.toBe(tooltips(idle)[0]);
});

it("leaves a settled write's verbs to the capability, so the user can try again", () => {
  const unsettled: MutationState[] = [
    { kind: "failed", failure: { kind: "conflict" } },
    {
      kind: "conflict",
      conflict: { write: "color", attempted: "#ff6666", fresh: "#5fb236" },
    },
  ];

  for (const mutation of unsettled) {
    expect(states(controlsOf({ kind: "writable" }, mutation))).toEqual([
      false,
      false,
      false,
    ]);
    expect(
      states(controlsOf({ kind: "read-only", reason: "probing" }, mutation)),
    ).toEqual([true, true, true]);
  }
});

it("names the comment verb for what pressing it would do", () => {
  expect(commentLabel(true)).not.toBe(commentLabel(false));
  expect(commentIcon(true)).not.toBe(commentIcon(false));
  expect(controlsOf({ kind: "writable" }).comment.tooltip).toBe(
    commentLabel(false),
  );
});

it("shows the current save outcome and preserves a manual recovery action", () => {
  const draft: CommentDraft = {
    annotationKey: "PUPR5FG5",
    attachmentKey: "RGRPDF24",
    serverID: "fixture",
    baseline: "",
    text: "Research note",
    state: { kind: "editing" },
  };
  expect(
    commentEditorControls({ kind: "writable", oneTime: true }, draft, NOW),
  ).toEqual({
    readOnly: false,
    saveDisabled: false,
    manual: true,
    hint: m.annot_view_comment_one_time(),
  });
  expect(
    commentEditorControls(
      { kind: "authorization-required" },
      { ...draft, manualSave: true, state: { kind: "pending" } },
      NOW,
    ),
  ).toEqual({
    readOnly: true,
    saveDisabled: true,
    manual: true,
    hint: m.annot_view_card_saving(),
  });
  expect(
    commentEditorControls(
      { kind: "writable" },
      {
        ...draft,
        manualSave: true,
        state: { kind: "failed", failure: { kind: "unknown-outcome" } },
      },
      NOW,
    ),
  ).toEqual({
    readOnly: false,
    saveDisabled: false,
    manual: true,
    hint: m.annot_view_comment_unconfirmed(),
  });
  expect(
    commentEditorControls(
      { kind: "read-only", reason: "zotero-unavailable" },
      { ...draft, manualSave: true },
      NOW,
    ),
  ).toEqual({
    readOnly: true,
    saveDisabled: true,
    manual: true,
    hint: m.annot_view_comment_paused(),
  });
  expect(
    commentEditorControls(
      { kind: "writable" },
      { ...draft, manualSave: true },
      NOW,
    ).hint,
  ).toBe(m.annot_view_comment_resume());
});
