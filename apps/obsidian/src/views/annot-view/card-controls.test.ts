import { describe, expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityCopy } from "@/services/annotation-repository/capability-copy";
import type {
  CommentDraft,
  TagDraft,
} from "@/services/annotation-repository/service";
import type { MutationState } from "@/services/annotation-repository/write";
import { IDLE } from "@/services/annotation-repository/write";

import {
  cardControls,
  capabilityBlock,
  commentIcon,
  commentLabel,
  commentEditorControls,
  editingBlockedReason,
  heldCommentDraft,
  heldTagDraft,
} from "./card-controls";
import type { CardBlock, CardControls } from "./card-controls";

const NOW = Temporal.Instant.from("2026-09-16T15:52:21Z");

/** The one capability that enables mutation controls. */
const LIVE: EditingCapability = { kind: "writable" };

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
  return cardControls({
    capability,
    mutation,
    hasComment: false,
    hasTags: false,
    now: NOW,
  });
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

function blocks(controls: CardControls): (CardBlock | null)[] {
  return [controls.color, controls.comment, controls.delete].map(
    ({ blocked }) => blocked,
  );
}

it("keeps every verb live where a gesture reaches Zotero, each naming itself", () => {
  const controls = controlsOf(LIVE);

  expect(states(controls)).toEqual([false, false, false]);
  expect(blocks(controls)).toEqual([null, null, null]);
  // Three verbs, three names: a live control's tooltip is what it does.
  expect(new Set(tooltips(controls)).size).toBe(3);
  expect(tooltips(controls).every((text) => text.length > 0)).toBe(true);
});

it("keeps a verb the capability blocks pressable, so its press reaches the reason", () => {
  for (const capability of BLOCKED) {
    const controls = controlsOf(capability);
    const copy = editingCapabilityCopy(capability, NOW);
    const reason = copy.detail ?? copy.label;
    const action =
      capability.kind === "authorization-required" ? "allow-editing" : null;

    // Not disabled: the press is what raises the notice holding the reason.
    expect(states(controls)).toEqual([false, false, false]);
    expect(blocks(controls)).toEqual([
      { reason, action },
      { reason, action },
      { reason, action },
    ]);
    // The verb keeps its own name; the notice is what states the reason.
    expect(tooltips(controls)).toEqual(
      tooltips(controlsOf({ kind: "writable" })),
    );
  }
});

it("offers Allow editing to the one capability a gesture can change", () => {
  expect(capabilityBlock({ kind: "authorization-required" }, NOW)).toEqual({
    reason: m.capability_authorization_required_detail(),
    action: "allow-editing",
  });
  expect(capabilityBlock({ kind: "authorizing" }, NOW)).toEqual({
    reason: m.capability_authorizing_detail(),
    action: null,
  });
  // A label stands in where the table has no detail sentence.
  expect(
    capabilityBlock({ kind: "read-only", reason: "probing" }, NOW),
  ).toEqual({ reason: m.capability_probing(), action: null });
  expect(capabilityBlock({ kind: "writable" }, NOW)).toBeNull();
});

it("counts a cooldown down each time the sentence is read again", () => {
  // The sentence is derived at the instant it is read, so the seconds it names
  // have to follow that instant.
  const capability: EditingCapability = {
    kind: "cooldown",
    retryAfter: NOW.add({ seconds: 30 }),
  };

  expect(capabilityBlock(capability, NOW)?.reason).toContain("30");
  expect(
    capabilityBlock(capability, NOW.add({ seconds: 10 }))?.reason,
  ).toContain("20");
});

it("answers every reader surface with the same reason string", () => {
  // The Mark Popup reads this export, so its answer stays a plain string.
  expect(
    editingBlockedReason({ kind: "authorization-required" }, IDLE, NOW),
  ).toBe(m.capability_authorization_required_detail());
  expect(editingBlockedReason({ kind: "writable" }, IDLE, NOW)).toBeNull();
  expect(
    editingBlockedReason(
      { kind: "writable" },
      { kind: "pending", write: "color" },
      NOW,
    ),
  ).toBe(m.annot_view_card_saving());
});

it("shows a write in flight as disabled verbs, whatever the capability says", () => {
  const pending = controlsOf(
    { kind: "writable" },
    { kind: "pending", write: "color" },
  );
  const idle = controlsOf({ kind: "writable" });

  expect(states(pending)).toEqual([true, true, true]);
  // A write in flight is the one case that truly cannot be pressed.
  expect(blocks(pending)).toEqual([null, null, null]);
  // One reason, and it is the write rather than the capability.
  expect(new Set(tooltips(pending)).size).toBe(1);
  expect(tooltips(pending)[0]).not.toBe(tooltips(idle)[0]);
});

it("draws a comment write in flight as nothing at all", () => {
  const comment = { kind: "pending", write: "comment" } as const;

  expect(controlsOf({ kind: "writable" }, comment)).toEqual(
    controlsOf({ kind: "writable" }),
  );
  expect(editingBlockedReason({ kind: "writable" }, comment, NOW)).toBeNull();
});

it("says a comment is saving only where the user pressed to save it", () => {
  const draft = {
    annotationKey: "PUPR5FG5",
    attachmentKey: "RGRPDF24",
    serverID: "fixture",
    baseline: "",
    text: "Research note",
    state: { kind: "pending" },
  } as const;

  expect(commentEditorControls({ kind: "writable" }, draft, NOW)).toEqual({
    readOnly: false,
    saveDisabled: false,
    manual: false,
    hint: null,
  });
  expect(
    commentEditorControls(
      { kind: "writable" },
      { ...draft, manualSave: true },
      NOW,
    ),
  ).toMatchObject({ saveDisabled: true, hint: m.annot_view_card_saving() });
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
      blocks(controlsOf({ kind: "read-only", reason: "probing" }, mutation)),
    ).toEqual([
      { reason: m.capability_probing(), action: null },
      { reason: m.capability_probing(), action: null },
      { reason: m.capability_probing(), action: null },
    ]);
  }
});

it("names the comment verb for what pressing it would do", () => {
  expect(commentLabel(true)).not.toBe(commentLabel(false));
  expect(commentIcon(true)).not.toBe(commentIcon(false));
  expect(controlsOf({ kind: "writable" }).comment.tooltip).toBe(
    commentLabel(false),
  );
});

it("gives the tag toggle the comment toggle's enabled state and blocked reason", () => {
  expect(controlsOf(LIVE).tags).toEqual({
    disabled: false,
    blocked: null,
    tooltip: m.annot_view_card_add_tags(),
  });
  for (const capability of BLOCKED) {
    const copy = editingCapabilityCopy(capability, NOW);
    // Pressable, so the press raises the notice that states the reason.
    expect(controlsOf(capability).tags).toEqual({
      disabled: false,
      blocked: {
        reason: copy.detail ?? copy.label,
        action:
          capability.kind === "authorization-required" ? "allow-editing" : null,
      },
      tooltip: m.annot_view_card_add_tags(),
    });
  }
  expect(
    controlsOf({ kind: "writable" }, { kind: "pending", write: "color" }).tags,
  ).toEqual({
    disabled: true,
    blocked: null,
    tooltip: m.annot_view_card_saving(),
  });
});

it("keeps every verb live while a tag session saves, since that save is no gesture", () => {
  const tags = { kind: "pending", write: "tags", session: true } as const;

  expect(controlsOf({ kind: "writable" }, tags)).toEqual(
    controlsOf({ kind: "writable" }),
  );
  expect(editingBlockedReason({ kind: "writable" }, tags, NOW)).toBeNull();
});

it("stands every verb down while a tag undo or redo is in flight", () => {
  const step = { kind: "pending", write: "tags" } as const;

  expect(controlsOf({ kind: "writable" }, step)).toEqual(
    controlsOf({ kind: "writable" }, { kind: "pending", write: "color" }),
  );
  expect(editingBlockedReason({ kind: "writable" }, step, NOW)).toBe(
    m.annot_view_card_saving(),
  );
});

it("names the tag toggle for what pressing it would do", () => {
  const tooltip = (hasTags: boolean) =>
    cardControls({
      capability: { kind: "writable" },
      mutation: IDLE,
      hasComment: false,
      hasTags,
      now: NOW,
    }).tags.tooltip;

  expect(tooltip(false)).toBe(m.annot_view_card_add_tags());
  expect(tooltip(true)).toBe(m.annot_view_card_edit_tags());
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
    hint: editingCapabilityCopy(
      { kind: "read-only", reason: "zotero-unavailable" },
      NOW,
    ).detail,
  });
  // A draft waiting on a manual save states nothing: its button does.
  expect(
    commentEditorControls(
      { kind: "writable" },
      { ...draft, manualSave: true },
      NOW,
    ),
  ).toEqual({
    readOnly: false,
    saveDisabled: false,
    manual: true,
    hint: null,
  });
  // A refused write answers in the capability's own words.
  expect(
    commentEditorControls(
      { kind: "authorization-required" },
      {
        ...draft,
        state: { kind: "failed", failure: { kind: "unauthorized" } },
      },
      NOW,
    ).hint,
  ).toBe(m.capability_authorization_required_detail());
});

describe("the held-draft panel", () => {
  const draft: CommentDraft = {
    annotationKey: "PUPR5FG5",
    attachmentKey: "RGRPDF24",
    serverID: "fixture",
    baseline: "",
    text: "Research note",
    state: { kind: "editing" },
  };
  const kinds = (capability: EditingCapability, held: CommentDraft) =>
    heldCommentDraft(capability, held, NOW)?.actions.map(
      (action) => action.kind,
    ) ?? null;

  it("stays quiet where nothing is asked of the user", () => {
    expect(heldCommentDraft({ kind: "writable" }, null, NOW)).toBeNull();
    // An editor opened and closed without typing holds what Zotero already has.
    expect(
      heldCommentDraft({ kind: "writable" }, { ...draft, text: "" }, NOW),
    ).toBeNull();
    // A write settles by itself, and the Conflict panel owns its own two verbs.
    expect(
      heldCommentDraft(
        { kind: "writable" },
        { ...draft, state: { kind: "pending" } },
        NOW,
      ),
    ).toBeNull();
    expect(
      heldCommentDraft(
        { kind: "writable" },
        { ...draft, state: { kind: "conflict", fresh: "In Zotero" } },
        NOW,
      ),
    ).toBeNull();
    // An automatic save is already on its way.
    expect(heldCommentDraft({ kind: "writable" }, draft, NOW)).toBeNull();
  });

  it("gives the accent to the way out, and never to Discard", () => {
    const accent = (capability: EditingCapability) =>
      heldCommentDraft(
        capability,
        { ...draft, manualSave: true },
        NOW,
      )?.actions.find((action) => action.primary)?.kind ?? null;
    expect(accent({ kind: "writable" })).toBe("save");
    // Saving is refused, so the grant that ends the refusal takes the accent.
    expect(accent({ kind: "authorization-required" })).toBe("allow-editing");
    expect(
      accent({ kind: "read-only", reason: "zotero-unavailable" }),
    ).toBeNull();
  });

  it("carries a way out of every state it announces", () => {
    expect(kinds({ kind: "writable" }, { ...draft, manualSave: true })).toEqual(
      ["save", "discard"],
    );
    expect(kinds({ kind: "authorization-required" }, draft)).toEqual([
      "save",
      "allow-editing",
      "discard",
    ]);
    expect(
      kinds({ kind: "read-only", reason: "zotero-unavailable" }, draft),
    ).toEqual(["save", "discard"]);
  });

  it("offers Discard where nothing else can act, and states why", () => {
    const held = heldCommentDraft(
      { kind: "read-only", reason: "zotero-unavailable" },
      draft,
      NOW,
    );
    expect(held?.text).toBe("Research note");
    // The capability's own sentence, not the editor's generic paused line.
    expect(held?.reason).toBe(
      editingCapabilityCopy(
        { kind: "read-only", reason: "zotero-unavailable" },
        NOW,
      ).detail,
    );
    // Nothing can act but Discard, and Discard never wears the accent.
    expect(held?.actions).toEqual([
      {
        kind: "save",
        label: m.annot_view_comment_save(),
        enabled: false,
        primary: false,
      },
      {
        kind: "discard",
        label: m.annot_view_comment_discard(),
        enabled: true,
        primary: false,
      },
    ]);
  });
});

describe("the held tags panel", () => {
  const draft: TagDraft = {
    annotationKey: "PUPR5FG5",
    attachmentKey: "RGRPDF24",
    serverID: "fixture",
    baseline: ["review"],
    names: ["review", "figure"],
    state: { kind: "editing" },
    manualSave: true,
    held: true,
  };

  it("stays quiet while a session is open, a save is in flight, or nothing changed", () => {
    // A session open on either surface: Save tags there would cut it short.
    expect(
      heldTagDraft({ kind: "writable" }, { ...draft, held: false }, NOW),
    ).toBeNull();
    expect(
      heldTagDraft({ kind: "writable" }, { ...draft, names: ["review"] }, NOW),
    ).toBeNull();
    expect(
      heldTagDraft(
        { kind: "writable" },
        { ...draft, state: { kind: "pending" } },
        NOW,
      ),
    ).toBeNull();
  });

  it("states each hold with the comment's reason line and offers Save tags", () => {
    const reason = (capability: EditingCapability, held: TagDraft) =>
      heldTagDraft(capability, held, NOW)?.reason;
    expect(
      reason(
        { kind: "writable" },
        {
          ...draft,
          state: { kind: "failed", failure: { kind: "unreachable" } },
        },
      ),
    ).toBe(m.annot_view_comment_unconfirmed());
    const unavailable: EditingCapability = {
      kind: "read-only",
      reason: "zotero-unavailable",
    };
    expect(reason(unavailable, draft)).toBe(
      editingCapabilityCopy(unavailable, NOW).detail,
    );
    const refused = heldTagDraft(
      { kind: "authorization-required" },
      {
        ...draft,
        state: { kind: "failed", failure: { kind: "unauthorized" } },
      },
      NOW,
    );
    expect(refused?.reason).toBe(m.capability_authorization_required_detail());
    expect(refused?.names).toEqual(["review", "figure"]);
    expect(refused?.actions).toEqual([
      {
        kind: "save",
        label: m.annot_view_tags_save(),
        enabled: false,
        primary: false,
      },
      {
        kind: "allow-editing",
        label: m.capability_enable_editing(),
        enabled: true,
        primary: true,
      },
      {
        kind: "discard",
        label: m.annot_view_comment_discard(),
        enabled: true,
        primary: false,
      },
    ]);
  });
});
