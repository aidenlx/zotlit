import { describe, expect, it } from "vitest";

import type { AnnotViewAttachment } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";

import {
  annotViewBody,
  attachmentLine,
  conditionLines,
  followModeIcon,
  followModeLabel,
  followModeMenu,
  identityLabel,
  pinBlockedReason,
} from "./presentation";
import type { FollowMenuEntry, FollowMenuState } from "./presentation";
import { createAnnotStore } from "./store";
import type { AnnotState } from "./store";

const ATTACHMENTS: AnnotViewAttachment[] = [
  {
    itemID: 1,
    indexedKey: "ATCH0001",
    path: "storage:first.pdf",
    annotCount: 2,
  },
  {
    itemID: 2,
    indexedKey: "ATCH0002",
    path: "storage:second.pdf",
    annotCount: 3,
  },
];

/** A view showing a Literature Note's Item with two attachments. */
function state(overrides: Partial<AnnotState> = {}): AnnotState {
  const store = createAnnotStore();
  store.setState({
    itemKey: "ABCD2345",
    pinnable: "ABCD2345",
    attachments: ATTACHMENTS,
    selectedAttachmentKey: "ATCH0001",
    annotations: [],
    annotationSource: { kind: "zotero-db" },
    liveUpdatesOn: true,
    ...overrides,
  });
  return store.getState();
}

/** The menu's entries as a reader sees them: label, and why it is blocked. */
function entryLabels(entries: FollowMenuEntry[]): (string | null)[] {
  return entries.map((entry) =>
    entry.kind === "separator" ? null : entry.label,
  );
}

function action(entries: FollowMenuEntry[], label: string) {
  return entries.find(
    (entry) => entry.kind !== "separator" && entry.label === label,
  );
}

describe("the Follow Mode table", () => {
  it("names and pictures each mode once", () => {
    expect(followModeLabel("active-tab")).toBe(m.annot_view_mode_active_tab());
    expect(followModeLabel("zotero-reader")).toBe(
      m.annot_view_mode_zotero_reader(),
    );
    expect(followModeLabel("pinned")).toBe(m.annot_view_mode_pinned());
    expect(
      new Set([
        followModeIcon("active-tab"),
        followModeIcon("zotero-reader"),
        followModeIcon("pinned"),
      ]).size,
    ).toBe(3);
  });
});

describe("the Follow Mode menu", () => {
  it("offers the two modes a gesture can switch to, and checks the one in force", () => {
    const entries = followModeMenu(state({ followMode: "zotero-reader" }));
    const modes = entries.filter((entry) => entry.kind === "mode");

    expect(
      modes.map((entry) => [entry.mode, entry.checked, entry.select]),
    ).toStrictEqual([
      ["active-tab", false, "active-tab"],
      ["zotero-reader", true, "zotero-reader"],
    ]);
  });

  it("reports Pinned as the mode in force, and never as a switch", () => {
    const entries = followModeMenu(state({ followMode: "pinned" }));
    const pinned = entries.find(
      (entry) => entry.kind === "mode" && entry.mode === "pinned",
    );

    expect(pinned).toMatchObject({ checked: true, select: null });
  });

  it("swaps Pin current item for Unpin while pinned", () => {
    const pinning = followModeMenu(state());
    expect(entryLabels(pinning)).toContain(
      m.annot_view_mode_pin_current_item(),
    );
    expect(entryLabels(pinning)).not.toContain(m.annot_view_mode_unpin());

    const pinned = followModeMenu(state({ followMode: "pinned" }));
    expect(entryLabels(pinned)).toContain(m.annot_view_mode_unpin());
    expect(entryLabels(pinned)).not.toContain(
      m.annot_view_mode_pin_current_item(),
    );
  });

  it("always offers the item picker", () => {
    for (const followMode of [
      "active-tab",
      "zotero-reader",
      "pinned",
    ] as const) {
      expect(
        action(
          followModeMenu(state({ followMode })),
          m.annot_view_pin_choose_item(),
        ),
      ).toMatchObject({ action: "choose-item", reason: null });
    }
  });

  it("blocks Pin current item with its reason, and only then", () => {
    expect(
      action(followModeMenu(state()), m.annot_view_mode_pin_current_item()),
    ).toMatchObject({ action: "pin-current-item", reason: null });

    // A standalone Attachment: an Attachment stands, but no Item owns it.
    const standalone = state({ itemKey: null, pinnable: null });
    expect(
      action(followModeMenu(standalone), m.annot_view_mode_pin_current_item()),
    ).toMatchObject({ reason: m.annot_view_pin_unavailable_standalone() });

    // Nothing at all resolved, which is a different reason.
    const nothing = state({
      itemKey: null,
      pinnable: null,
      attachments: null,
      selectedAttachmentKey: null,
    });
    expect(
      action(followModeMenu(nothing), m.annot_view_mode_pin_current_item()),
    ).toMatchObject({ reason: m.annot_view_pin_unavailable_none() });
  });

  it("separates the modes from the gestures", () => {
    const entries = followModeMenu(state());
    const separator = entries.findIndex((entry) => entry.kind === "separator");

    expect(separator).toBeGreaterThan(0);
    expect(
      entries.slice(0, separator).every((entry) => entry.kind === "mode"),
    ).toBe(true);
    expect(
      entries.slice(separator + 1).every((entry) => entry.kind === "action"),
    ).toBe(true);
  });
});

describe("pinBlockedReason", () => {
  it("answers null while an Item stands to be pinned", () => {
    const pinnable: FollowMenuState = {
      followMode: "active-tab",
      pinnable: "ABCD2345",
      selectedAttachmentKey: "ATCH0001",
    };
    expect(pinBlockedReason(pinnable)).toBeNull();
  });
});

describe("the attachment slot", () => {
  it("offers every Attachment while the choice is the user's", () => {
    expect(attachmentLine(state())).toStrictEqual({
      kind: "picker",
      selectedKey: "ATCH0001",
      options: [
        {
          key: "ATCH0001",
          label: m.annot_view_attachment_label({ name: "first.pdf", count: 2 }),
        },
        {
          key: "ATCH0002",
          label: m.annot_view_attachment_label({
            name: "second.pdf",
            count: 3,
          }),
        },
      ],
    });
  });

  it("names the Attachment the Zotero reader holds, and who holds it", () => {
    expect(
      attachmentLine(state({ attachmentLock: "zotero-reader" })),
    ).toStrictEqual({
      kind: "locked",
      label: m.annot_view_attachment_label({ name: "first.pdf", count: 2 }),
      reason: m.annot_view_attachment_locked_reader(),
    });
  });

  it("shows nothing while the open Obsidian PDF already names it", () => {
    expect(attachmentLine(state({ attachmentLock: "obsidian-pdf" }))).toEqual({
      kind: "hidden",
    });
  });

  it("shows nothing where there is no choice to make", () => {
    expect(attachmentLine(state({ attachments: [ATTACHMENTS[0]!] }))).toEqual({
      kind: "hidden",
    });
    expect(
      attachmentLine(state({ attachments: null, selectedAttachmentKey: null })),
    ).toEqual({ kind: "hidden" });
  });

  it("names an Attachment Zotero stored without a filename", () => {
    const unnamed = state({
      attachments: [
        { itemID: 9, indexedKey: "ATCH0009", path: null, annotCount: 0 },
        ATTACHMENTS[1]!,
      ],
      selectedAttachmentKey: "ATCH0009",
    });
    expect(attachmentLine(unnamed)).toMatchObject({
      selectedKey: "ATCH0009",
      options: [
        {
          key: "ATCH0009",
          label: m.annot_view_attachment_label({
            name: m.annot_view_attachment_unnamed(),
            count: 0,
          }),
        },
        expect.anything(),
      ],
    });
  });
});

describe("what stands where the card list would", () => {
  it("lists once an Attachment and its Annotations are read", () => {
    expect(annotViewBody(state())).toEqual({ kind: "list" });
  });

  it("waits while the Attachment stands but its Annotations have not arrived", () => {
    expect(annotViewBody(state({ annotations: null }))).toEqual({
      kind: "loading",
    });
  });

  it("says so for an Item with no Attachments at all", () => {
    expect(annotViewBody(state({ attachments: [] }))).toEqual({
      kind: "no-attachments",
      message: m.annot_view_no_attachments(),
    });
  });

  it("asks for a literature note or a Zotero PDF while following the active tab", () => {
    expect(annotViewBody(state({ attachments: null }))).toEqual({
      kind: "empty",
      message: m.annot_view_empty_active_tab(),
      action: null,
    });
  });

  it("offers to turn Live updates on when the Zotero reader cannot reach the view", () => {
    expect(
      annotViewBody(
        state({
          attachments: null,
          followMode: "zotero-reader",
          liveUpdatesOn: false,
        }),
      ),
    ).toEqual({
      kind: "empty",
      message: m.annot_view_empty_live_updates_off(),
      action: {
        label: m.annot_view_enable_live_updates(),
        action: "enable-live-updates",
      },
    });
  });

  it("asks for an open Zotero reader once Live updates is on", () => {
    expect(
      annotViewBody(state({ attachments: null, followMode: "zotero-reader" })),
    ).toEqual({
      kind: "empty",
      message: m.annot_view_empty_zotero_reader(),
      action: null,
    });
  });

  it("offers the item picker while nothing is pinned", () => {
    expect(
      annotViewBody(state({ attachments: null, followMode: "pinned" })),
    ).toEqual({
      kind: "empty",
      message: m.annot_view_empty_pinned(),
      action: { label: m.annot_view_pin_choose_item(), action: "choose-item" },
    });
  });

  it("does not deny a pin it is still holding", () => {
    // A pin whose library the database cannot name resolves to nothing, but
    // the pin stands — telling the user to pin something would be a lie.
    expect(
      annotViewBody(
        state({
          attachments: null,
          followMode: "pinned",
          pinnedItemKey: "ABCD2345g7",
        }),
      ),
    ).toEqual({
      kind: "empty",
      message: m.annot_view_empty_pinned_unresolved(),
      action: { label: m.annot_view_pin_choose_item(), action: "choose-item" },
    });
  });
});

describe("the condition lines", () => {
  it("says the list came from the Zotero database", () => {
    expect(conditionLines(state())).toStrictEqual([
      m.annot_view_source_database(),
    ]);
  });

  it("says nothing about the source while the Zotero Local API answered", () => {
    expect(
      conditionLines(
        state({
          annotationSource: {
            kind: "zotero-local-api",
            serverID: "abcdef012345",
          },
        }),
      ),
    ).toStrictEqual([]);
  });

  it("says the Zotero reader closed, above the source it read from", () => {
    expect(
      conditionLines(
        state({ followMode: "zotero-reader", zoteroReaderClosed: true }),
      ),
    ).toStrictEqual([
      m.annot_view_reader_closed(),
      m.annot_view_source_database(),
    ]);
  });

  it("says nothing about a closed reader in the other modes", () => {
    expect(conditionLines(state({ zoteroReaderClosed: true }))).not.toContain(
      m.annot_view_reader_closed(),
    );
  });

  it("says nothing about a closed reader with no attachment on screen", () => {
    expect(
      conditionLines(
        state({
          followMode: "zotero-reader",
          zoteroReaderClosed: true,
          attachments: null,
        }),
      ),
    ).not.toContain(m.annot_view_reader_closed());
  });
});

describe("the identity block", () => {
  it("stays hidden while the active tab already names the item", () => {
    expect(
      identityLabel(state({ itemDisplayLabel: "A Paper — Author (2024)" })),
    ).toBeNull();
  });

  it("names the item in the modes nothing else on screen names it", () => {
    for (const followMode of ["zotero-reader", "pinned"] as const) {
      expect(
        identityLabel(
          state({ followMode, itemDisplayLabel: "A Paper — Author (2024)" }),
        ),
      ).toBe("A Paper — Author (2024)");
    }
  });
});
