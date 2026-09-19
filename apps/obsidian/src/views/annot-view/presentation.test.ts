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
} from "./presentation";
import type { FollowMenuAction, FollowMenuEntry } from "./presentation";
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

/** What the menu runs, in the order it offers it. */
function entryActions(entries: FollowMenuEntry[]): FollowMenuAction[] {
  return entries.map((entry) => entry.action);
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
  it("offers the two mode switches, the pin, and the item picker", () => {
    const entries = followModeMenu(state({ followMode: "zotero-reader" }));

    expect(entries.map((entry) => [entry.action, entry.label])).toStrictEqual([
      ["active-tab", m.annot_view_mode_active_tab()],
      ["zotero-reader", m.annot_view_mode_zotero_reader()],
      ["pin-current-item", m.annot_view_mode_pin_current_item()],
      ["choose-item", m.annot_view_pin_choose_item()],
    ]);
  });

  it("pictures every entry, whatever the mode", () => {
    for (const followMode of [
      "active-tab",
      "zotero-reader",
      "pinned",
    ] as const) {
      const icons = followModeMenu(state({ followMode })).map(
        (entry) => entry.icon,
      );
      expect(icons.filter((icon) => icon.length > 0)).toStrictEqual(icons);
    }
  });

  it("swaps Pin current item for Unpin while pinned", () => {
    expect(
      entryActions(followModeMenu(state({ followMode: "pinned" }))),
    ).toStrictEqual(["active-tab", "zotero-reader", "unpin", "choose-item"]);
  });

  it("leaves out the pin while no Item stands to be pinned", () => {
    // A standalone Attachment: an Attachment stands, but no Item owns it.
    const standalone = state({ itemKey: null, pinnable: null });

    expect(entryActions(followModeMenu(standalone))).toStrictEqual([
      "active-tab",
      "zotero-reader",
      "choose-item",
    ]);
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
  it("keeps an ordinary database-backed list free of source captions", () => {
    expect(conditionLines(state())).toStrictEqual([]);
  });

  it("says the Zotero reader closed", () => {
    expect(
      conditionLines(
        state({ followMode: "zotero-reader", zoteroReaderClosed: true }),
      ),
    ).toStrictEqual([m.annot_view_reader_closed()]);
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
