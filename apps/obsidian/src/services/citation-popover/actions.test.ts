// @vitest-environment happy-dom
import { Keymap, Menu } from "obsidian";
import type { MouseEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCitationPopoverActions } from "./actions";
import type { CitationEntryBlock } from "./blocks";

const menuMock = Menu as typeof Menu & {
  instances: {
    items: { title: string; click: () => void }[];
    position: { x: number; y: number } | null;
  }[];
};

const block = (
  overrides: Partial<CitationEntryBlock> = {},
): CitationEntryBlock => ({
  kind: "entry",
  citekey: "doe2024",
  marker: undefined,
  serial: undefined,
  content: [{ t: "Str", c: "Doe (2024)" }],
  summary: "Doe (2024): Book",
  itemKey: "BOOK0001",
  groupID: null,
  attachments: [],
  ...overrides,
});

/** A click, as React hands one to a button's handler. */
function click({
  button = 0,
  detail = 1,
}: { button?: number; detail?: number } = {}): MouseEvent {
  const target = document.createElement("div");
  const native = new globalThis.MouseEvent("click", { button, detail });
  return {
    button,
    detail,
    currentTarget: target,
    nativeEvent: native,
  } as unknown as MouseEvent;
}

function actions() {
  const opened: [citekey: string, pane: unknown][] = [];
  const hide = vi.fn();
  return {
    opened,
    hide,
    ...createCitationPopoverActions({
      open: (citekey, pane) => opened.push([citekey, pane]),
      hide,
    }),
  };
}

beforeEach(() => {
  menuMock.instances = [];
});

describe("createCitationPopoverActions", () => {
  it("opens the work's note in the pane the click asks for", () => {
    const { onOpenNote, opened } = actions();

    onOpenNote(block(), click());
    vi.spyOn(Keymap, "isModEvent").mockReturnValue("tab");
    onOpenNote(block({ citekey: "smith2025" }), click());
    onOpenNote(block({ citekey: "gray2019" }), click({ button: 1 }));

    expect(opened).toEqual([
      ["doe2024", false],
      ["smith2025", "tab"],
      ["gray2019", "tab"],
    ]);
  });

  it("selects the Item in Zotero without guarding its reachability", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { onOpenInZotero } = actions();

    onOpenInZotero(block({ itemKey: "ITEM0009", groupID: 7 }));

    expect(open).toHaveBeenCalledExactlyOnceWith(
      "zotero://select/groups/7/items/ITEM0009",
    );
  });

  it("opens a single Attachment straight away", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { onOpenAttachment } = actions();

    onOpenAttachment(
      block({
        attachments: [{ key: "ATT1", groupID: null, label: "paper.pdf" }],
      }),
      click(),
    );

    expect(open).toHaveBeenCalledExactlyOnceWith(
      "zotero://open/library/items/ATT1",
    );
    expect(menuMock.instances).toEqual([]);
  });

  it("offers a menu when the Item carries several Attachments", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { onOpenAttachment } = actions();

    onOpenAttachment(
      block({
        attachments: [
          { key: "ATT1", groupID: null, label: "paper.pdf" },
          { key: "ATT2", groupID: null, label: "notes.pdf" },
        ],
      }),
      click(),
    );

    const menu = menuMock.instances[0];
    expect(menu?.items.map((item) => item.title)).toEqual([
      "paper.pdf",
      "notes.pdf",
    ]);
    expect(open).not.toHaveBeenCalled();
    menu?.items[1]?.click();
    expect(open).toHaveBeenCalledExactlyOnceWith(
      "zotero://open/library/items/ATT2",
    );
  });

  it("puts the menu at the button a keyboard activation came from", () => {
    const { onOpenAttachment } = actions();

    onOpenAttachment(
      block({
        attachments: [
          { key: "ATT1", groupID: null, label: "paper.pdf" },
          { key: "ATT2", groupID: null, label: "notes.pdf" },
        ],
      }),
      click({ detail: 0 }),
    );

    expect(menuMock.instances[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it("hides the popover once an action has run", () => {
    const { onDone, hide } = actions();

    onDone();

    expect(hide).toHaveBeenCalledOnce();
  });
});
