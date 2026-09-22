import { describe, expect, it } from "vitest";

import type { AnnotViewAttachment } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import type { ItemSummary } from "@/lib/item-summary";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityCopy } from "@/services/annotation-repository/capability-copy";

import {
  annotViewBody,
  attachmentLine,
  followModeIcon,
  followModeLabel,
  followModeMenu,
  headerIndicators,
  headerMenu,
  headerShape,
} from "./presentation";
import type {
  FollowMenuAction,
  FollowMenuEntry,
  HeaderMenuEntry,
} from "./presentation";
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

/** An Item the header can name: its own title over its creators and year. */
const PAPER: ItemSummary = {
  title: "A paper",
  subtitle: "Author (2024)",
  formatted: "Author (2024): A paper",
};

/** Editing is on, so no capability reaches the header or its menu. */
const WRITABLE: EditingCapability = { kind: "writable" };

const NOW = Temporal.Instant.from("2026-09-22T10:00:00Z");
const RETRY_AFTER = NOW.add({ seconds: 30 });

/** A view showing a Literature Note's Item with two attachments. */
function state(overrides: Partial<AnnotState> = {}): AnnotState {
  const store = createAnnotStore();
  store.setState({
    itemKey: "ABCD2345",
    pinnable: "ABCD2345",
    attachments: ATTACHMENTS,
    selectedAttachmentKey: "ATCH0001",
    annotations: [],
    annotationSource: {
      kind: "zotero-db",
      database: { userID: null, localUserKey: null, serverID: null },
      libraryID: 1,
      libraryRevision: null,
    },
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

describe("the header's indicators", () => {
  it("keeps an ordinary writable list free of indicators", () => {
    expect(
      headerIndicators(
        state({ attachments: [ATTACHMENTS[0]!], capability: WRITABLE }),
      ),
    ).toStrictEqual([]);
  });

  it("counts the attachments while the choice is the user's", () => {
    expect(headerIndicators(state({ capability: WRITABLE }))).toStrictEqual([
      "2 attachments",
    ]);
  });

  it("says nothing about attachments a reader chose", () => {
    expect(
      headerIndicators(
        state({ attachmentLock: "zotero-reader", capability: WRITABLE }),
      ),
    ).toStrictEqual([]);
  });

  it("reports every capability that cannot write", () => {
    for (const capability of [
      { kind: "authorization-required" },
      { kind: "authorizing" },
      { kind: "cooldown", retryAfter: RETRY_AFTER },
      { kind: "read-only", reason: "zotero-unavailable" },
      { kind: "read-only", reason: "library-read-only" },
    ] as const) {
      expect(
        headerIndicators(state({ attachments: [ATTACHMENTS[0]!], capability })),
      ).toStrictEqual(["Reading only"]);
    }
  });

  it("stays quiet while the capability is still being checked", () => {
    expect(
      headerIndicators(
        state({
          attachments: [ATTACHMENTS[0]!],
          capability: { kind: "read-only", reason: "probing" },
        }),
      ),
    ).toStrictEqual([]);
  });

  it("says the reader closed, after the count and the read-only state", () => {
    expect(
      headerIndicators(
        state({
          followMode: "zotero-reader",
          zoteroReaderClosed: true,
          capability: { kind: "read-only", reason: "zotero-unavailable" },
        }),
      ),
    ).toStrictEqual(["2 attachments", "Reading only", "Reader closed"]);
  });

  it("says nothing about a closed reader in the other modes", () => {
    expect(headerIndicators(state({ zoteroReaderClosed: true }))).not.toContain(
      "Reader closed",
    );
  });

  it("says nothing about a closed reader with no attachment on screen", () => {
    expect(
      headerIndicators(
        state({
          followMode: "zotero-reader",
          zoteroReaderClosed: true,
          attachments: null,
        }),
      ),
    ).not.toContain("Reader closed");
  });
});

describe("the header's shape", () => {
  it("stands the mode phrase in a status bar while the active tab names the item", () => {
    expect(
      headerShape(state({ attachments: [ATTACHMENTS[0]!] })),
    ).toStrictEqual({
      kind: "status-bar",
      modeIcon: followModeIcon("active-tab"),
      modeLabel: "Following the active tab",
      indicators: [],
      label: "Following the active tab.",
    });
  });

  it("names the item over a byline where nothing else on screen names it", () => {
    expect(
      headerShape(
        state({
          followMode: "pinned",
          attachments: [ATTACHMENTS[0]!],
          itemDisplay: PAPER,
          capability: WRITABLE,
        }),
      ),
    ).toStrictEqual({
      kind: "masthead",
      modeIcon: followModeIcon("pinned"),
      title: "A paper",
      byline: ["Author (2024)"],
      label: "A paper. Pinned.",
    });
  });

  it("carries the indicators in the byline, after the creators", () => {
    expect(
      headerShape(
        state({
          followMode: "pinned",
          itemDisplay: PAPER,
          capability: { kind: "read-only", reason: "zotero-unavailable" },
        }),
      ),
    ).toMatchObject({
      byline: ["Author (2024)", "2 attachments", "Reading only"],
      label: "A paper. Pinned. 2 attachments. Reading only.",
    });
  });

  it("drops the byline's creators for an item Zotero stored without any", () => {
    expect(
      headerShape(
        state({
          followMode: "pinned",
          attachments: [ATTACHMENTS[0]!],
          itemDisplay: { title: "A paper", subtitle: "", formatted: "A paper" },
          capability: WRITABLE,
        }),
      ),
    ).toMatchObject({ byline: [] });
  });

  it("names the mode in words for a screen reader in the status bar too", () => {
    expect(
      headerShape(
        state({
          followMode: "zotero-reader",
          capability: { kind: "read-only", reason: "zotero-unavailable" },
        }),
      ),
    ).toMatchObject({
      label: "Following the Zotero reader. 2 attachments. Reading only.",
    });
  });

  it("gives a screen reader every fact the eye gets", () => {
    const shape = headerShape(
      state({
        followMode: "zotero-reader",
        zoteroReaderClosed: true,
        capability: { kind: "read-only", reason: "zotero-unavailable" },
      }),
    );

    expect(shape).toMatchObject({
      indicators: ["2 attachments", "Reading only", "Reader closed"],
      label:
        "Following the Zotero reader. 2 attachments. Reading only. Reader closed.",
    });
  });

  it("names a closed reader on its own, under an item it can name", () => {
    expect(
      headerShape(
        state({
          followMode: "zotero-reader",
          zoteroReaderClosed: true,
          attachments: [ATTACHMENTS[0]!],
          itemDisplay: PAPER,
          capability: WRITABLE,
        }),
      ),
    ).toMatchObject({
      byline: ["Author (2024)", "Reader closed"],
      label: "A paper. Zotero reader. Reader closed.",
    });
  });
});

/** The rows one group offers, each as its text and what pressing it runs. */
function rows(group: HeaderMenuEntry[]): (string | undefined)[][] {
  return group.map((entry) => [
    entry.label,
    entry.action === undefined ? undefined : entry.action.kind,
  ]);
}

describe("the header's menu", () => {
  it("leads with the Follow Mode, checking the one in force", () => {
    const [modes] = headerMenu(
      state({ followMode: "zotero-reader", capability: WRITABLE }),
      NOW,
    );

    expect(rows(modes!)).toStrictEqual([
      ["Show annotations from", undefined],
      ["Active tab", "follow"],
      ["Zotero reader", "follow"],
    ]);
    expect(modes!.map((entry) => entry.checked)).toStrictEqual([
      undefined,
      undefined,
      true,
    ]);
    expect(modes![0]!.report).toBe(true);
  });

  it("names the pin itself as the mode in force", () => {
    const [modes] = headerMenu(
      state({ followMode: "pinned", capability: WRITABLE }),
      NOW,
    );

    expect(rows(modes!)).toStrictEqual([
      ["Show annotations from", undefined],
      ["Active tab", "follow"],
      ["Zotero reader", "follow"],
      ["Pinned", undefined],
    ]);
    expect(modes![3]!.checked).toBe(true);
  });

  it("offers the pin and the item picker in their own group", () => {
    const [, pin] = headerMenu(state({ capability: WRITABLE }), NOW);

    expect(rows(pin!)).toStrictEqual([
      ["Pin current item", "follow"],
      ["Choose item…", "follow"],
    ]);
  });

  it("opens the attachment picker while the choice is the user's", () => {
    const groups = headerMenu(state({ capability: WRITABLE }), NOW);

    expect(rows(groups[2]!)).toStrictEqual([
      ["Choose attachment…", "choose-attachment"],
    ]);
  });

  it("names the attachment a reader holds, and who holds it", () => {
    const groups = headerMenu(
      state({ attachmentLock: "zotero-reader", capability: WRITABLE }),
      NOW,
    );

    expect(groups[2]).toStrictEqual([
      {
        label: "first.pdf (2)",
        icon: "lock",
        disabled: true,
      },
      {
        label: "The Zotero reader chooses this attachment",
        report: true,
      },
    ]);
  });

  it("leaves the attachment group out where there is no choice to report", () => {
    const groups = headerMenu(
      state({ attachments: [ATTACHMENTS[0]!], capability: WRITABLE }),
      NOW,
    );

    expect(groups.flatMap(rows)).not.toContainEqual([
      "Choose attachment…",
      "choose-attachment",
    ]);
  });

  it("reports a closed Zotero reader in a group of its own", () => {
    const groups = headerMenu(
      state({
        followMode: "zotero-reader",
        zoteroReaderClosed: true,
        capability: WRITABLE,
      }),
      NOW,
    );

    expect(groups.at(-1)).toStrictEqual([
      {
        label: m.annot_view_reader_closed(),
        report: true,
      },
    ]);
  });

  it("offers Allow editing under the state it would fix", () => {
    const groups = headerMenu(
      state({
        attachments: [ATTACHMENTS[0]!],
        capability: { kind: "authorization-required" },
      }),
      NOW,
    );

    expect(groups.at(-1)).toStrictEqual([
      {
        label: "Allow editing to change annotations",
        report: true,
      },
      {
        label: "Allow editing",
        icon: "pencil",
        action: { kind: "allow-editing" },
      },
    ]);
  });

  it("reports a capability with no action, and offers none", () => {
    for (const capability of [
      { kind: "authorizing" },
      { kind: "cooldown", retryAfter: RETRY_AFTER },
      { kind: "read-only", reason: "library-read-only" },
    ] as const) {
      const groups = headerMenu(
        state({ attachments: [ATTACHMENTS[0]!], capability }),
        NOW,
      );

      expect(groups.at(-1)).toStrictEqual([
        { label: editingCapabilityCopy(capability, NOW).label, report: true },
      ]);
    }
  });

  it("says nothing about a capability that writes, or one still being checked", () => {
    for (const capability of [
      WRITABLE,
      { kind: "read-only", reason: "probing" },
    ] as const) {
      const groups = headerMenu(
        state({ attachments: [ATTACHMENTS[0]!], capability }),
        NOW,
      );

      expect(groups.flatMap(rows).map(([label]) => label)).not.toContain(
        "Allow editing",
      );
      expect(groups).toHaveLength(2);
    }
  });

  it("keeps the detail sentence out of every row", () => {
    const groups = headerMenu(
      state({ capability: { kind: "authorization-required" } }),
      NOW,
    );

    expect(groups.flatMap(rows).map(([label]) => label)).not.toContain(
      m.capability_authorization_required_detail(),
    );
  });
});
