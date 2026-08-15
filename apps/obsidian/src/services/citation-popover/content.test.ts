// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import type { CitationPopoverActions } from "./actions";
import type { CitationEntryBlock, CitationPopoverBlock } from "./blocks";
import { CitationPopoverContent } from "./content";

vi.mock("@/components/obsidian/icon-button", async () => {
  const { createElement } = await import("react");
  return {
    IconButton: ({ icon, ...props }: { icon: string }) =>
      createElement("button", { ...props, "data-icon": icon }),
  };
});

const actions: CitationPopoverActions = {
  onOpenNote: vi.fn(),
  onOpenInZotero: vi.fn(),
  onOpenAttachment: vi.fn(),
  onDone: vi.fn(),
};

const entry = (
  citekey: string,
  overrides: Partial<CitationEntryBlock> = {},
): CitationEntryBlock => ({
  kind: "entry",
  citekey,
  marker: undefined,
  serial: undefined,
  content: [{ t: "Str", c: `Entry of ${citekey}` }],
  summary: `Summary of ${citekey}`,
  itemKey: "BOOK0001",
  groupID: null,
  attachments: [],
  ...overrides,
});

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function render(
  blocks: readonly CitationPopoverBlock[],
): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => {
    root!.render(createElement(CitationPopoverContent, { blocks, actions }));
  });
  return container;
}

const blocksOf = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>("[data-citation-popover-block]"),
];

const iconsOf = (block: HTMLElement): (string | null)[] =>
  [...block.querySelectorAll("button")].map((button) =>
    button.getAttribute("data-icon"),
  );

describe("CitationPopoverContent", () => {
  it("stacks one block per work, in the order the citation names them", async () => {
    const container = await render([entry("smith2025"), entry("doe2024")]);

    const stacked = blocksOf(container);
    expect(
      stacked.map((block) => block.getAttribute("data-citation-popover-block")),
    ).toEqual(["smith2025", "doe2024"]);
    expect(stacked[0]!.textContent).toContain("Entry of smith2025");
  });

  it("puts each entry's action row after its own entry, for the placement to flip", async () => {
    const container = await render([entry("doe2024")]);

    const [block] = blocksOf(container);
    const row = block!.querySelector("[data-citation-popover-actions]");
    expect(block!.lastElementChild).toBe(row);
    expect(block!.firstElementChild?.textContent).toContain("Entry of doe2024");
  });

  it("shows the Entry Marker in the gutter, and the Entry Serial in its place", async () => {
    const marked = await render([
      entry("doe2024", { marker: [{ t: "Str", c: "[1]" }], serial: 4 }),
    ]);
    expect(blocksOf(marked)[0]!.textContent).toContain("[1]");

    await act(() => root?.unmount());
    const serialled = await render([entry("doe2024", { serial: 4 })]);
    expect(blocksOf(serialled)[0]!.textContent).toContain("4");
  });

  it("shows the work's summary where no bibliography formatted it", async () => {
    const container = await render([
      entry("doe2024", { content: null, summary: "Doe (2024): Book" }),
    ]);

    expect(blocksOf(container)[0]!.textContent).toContain("Doe (2024): Book");
  });

  it("offers the note and Zotero actions on every resolved work", async () => {
    const container = await render([entry("doe2024")]);

    expect(iconsOf(blocksOf(container)[0]!)).toEqual([
      "file-text",
      "external-link",
    ]);
  });

  it("offers the attachment action only where the Item has one to open", async () => {
    const container = await render([
      entry("doe2024", {
        attachments: [{ key: "ATT1", groupID: null, label: "paper.pdf" }],
      }),
    ]);

    expect(iconsOf(blocksOf(container)[0]!)).toContain("paperclip");
  });

  it("names its actions with the labels the References Sidebar uses", async () => {
    const container = await render([
      entry("doe2024", {
        attachments: [{ key: "ATT1", groupID: null, label: "paper.pdf" }],
      }),
    ]);

    expect(
      [...blocksOf(container)[0]!.querySelectorAll("button")].map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual([
      m.references_open_note(),
      m.references_open_in_zotero(),
      m.references_open_attachment(),
    ]);
  });

  it("runs each action and closes the popover behind it", async () => {
    const block = entry("doe2024", {
      attachments: [{ key: "ATT1", groupID: null, label: "paper.pdf" }],
    });
    const container = await render([block]);
    const buttons = [...blocksOf(container)[0]!.querySelectorAll("button")];

    for (const button of buttons) {
      await act(() => {
        button.click();
      });
    }

    expect(actions.onOpenNote).toHaveBeenCalledOnce();
    expect(actions.onOpenNote).toHaveBeenCalledWith(
      block,
      expect.objectContaining({ type: "click" }),
    );
    expect(actions.onOpenInZotero).toHaveBeenCalledExactlyOnceWith(block);
    expect(actions.onOpenAttachment).toHaveBeenCalledOnce();
    expect(actions.onDone).toHaveBeenCalledTimes(3);
  });

  it("explains an unresolved citekey and offers nothing on it", async () => {
    const container = await render([
      { kind: "unresolved", citekey: "typo2024" },
      entry("doe2024"),
    ]);

    const [unresolved] = blocksOf(container);
    expect(unresolved!.textContent).toBe(
      m.references_citekey_unresolved({ citekey: "typo2024" }),
    );
    expect(iconsOf(unresolved!)).toEqual([]);
  });

  it("opens for a citation none of whose keys reaches an Item", async () => {
    const container = await render([
      { kind: "unresolved", citekey: "typo2024" },
      { kind: "unresolved", citekey: "gone2020" },
    ]);

    expect(blocksOf(container)).toHaveLength(2);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
