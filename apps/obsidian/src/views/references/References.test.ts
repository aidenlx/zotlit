// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CitationOccurrence } from "@/services/citation-index/service";

import type { ReferenceActions } from "./actions";
import type { ReferenceEntry, ReferenceSource } from "./entries";
import { References } from "./References";
import type { ReferencesListMode, ReferencesState } from "./store";

vi.mock("@/components/obsidian/icon-button", async () => {
  const { createElement } = await import("react");
  return {
    IconButton: ({ icon, ...props }: { icon: string }) =>
      createElement("button", { ...props, "data-icon": icon }),
  };
});

vi.mock("./actions", () => ({
  useReferenceActions: () => actions,
}));

vi.mock("./store", () => ({
  useReferencesStore: <T>(selector: (current: ReferencesState) => T) =>
    selector(state),
}));

const actions: ReferenceActions = {
  onSelect: () => undefined,
  onOpenNote: () => undefined,
  onOpenInZotero: () => undefined,
  onOpenAttachment: () => undefined,
  onOpenEngineSettings: () => undefined,
  onChangeStyle: vi.fn(),
  onDismissEngineHint: () => undefined,
};

const occurrence: CitationOccurrence = {
  kind: "citekey",
  raw: "key",
  position: {
    start: { line: 0, col: 0, offset: 0 },
    end: { line: 0, col: 4, offset: 4 },
  },
};

const source: ReferenceSource = {
  csl: { id: "ref-book", type: "book", title: "Book" },
  summary: "Rivers (2020): Book",
  itemKey: "BOOK0001",
  itemID: 1,
  groupID: null,
  attachments: [],
};

let state: ReferencesState;
let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function render(
  entries: readonly ReferenceEntry[],
  listMode: ReferencesListMode,
  {
    formattingFailed = false,
    engine = { kind: "installed", version: "test" },
  }: Partial<Pick<ReferencesState, "formattingFailed" | "engine">> = {},
): Promise<HTMLElement> {
  state = {
    entries,
    listMode,
    engine,
    formattingFailed,
    dbReady: true,
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => {
    root!.render(createElement(References));
  });
  return container;
}

describe("References", () => {
  it("owns its empty-state presentation", async () => {
    const container = await render([], { kind: "minimal" });
    const empty = container.querySelector("[data-references-empty]");

    expect(empty).not.toBeNull();
    expect(empty?.classList).toContain("zt:text-faint");
    expect(container.querySelector(".pane-empty")).toBeNull();
  });

  it("hides the warning gutter when the style shows no Entry Marker", async () => {
    const container = await render(
      [
        {
          id: "GONE0002",
          refNumber: 2,
          occurrences: [occurrence],
          kind: "missing",
          linkpath: "notes/aVeryLongCitekeyWithoutBreaks00000000000000000002",
        },
        {
          id: "@typo",
          refNumber: 3,
          occurrences: [occurrence],
          kind: "unresolved",
          citekey: "aVeryLongCitekeyWithoutBreaks00000000000000000003",
        },
      ],
      { kind: "bibliography", hasEntryMarkers: false },
    );

    const list = container.querySelector("ul")!;
    expect(list.classList).toContain(
      "zt:grid-cols-[minmax(0,1fr)_max-content]",
    );
    const rows = [...list.children];
    expect(container.textContent).not.toContain("⚠");
    expect(
      [...rows[0]!.querySelectorAll(".zt\\:text-destructive")].some((el) =>
        el.classList.contains("zt:break-words"),
      ),
    ).toBe(true);
  });

  it("shares a numeric style's gutter with an unrendered Reference Error", async () => {
    const content = document.createDocumentFragment();
    content.append("Rendered book");
    const container = await render(
      [
        {
          id: "BOOK0001",
          refNumber: 1,
          occurrences: [occurrence],
          kind: "rendered",
          source,
          linkpath: "notes/BOOK0001",
          marker: "[1]",
          content,
        },
        {
          id: "BOOK0002",
          refNumber: 2,
          occurrences: [occurrence],
          kind: "unrendered",
          source,
          linkpath: "notes/BOOK0002",
        },
      ],
      { kind: "bibliography", hasEntryMarkers: true },
    );

    const rows = container.querySelectorAll("li");
    expect(rows[0]!.children[0]!.textContent).toBe("[1]");
    const row = rows[1]!;
    expect(row.children[0]!.textContent).toBe("⚠");
    expect(row.querySelector(".zt\\:text-foreground")!.textContent).toBe(
      source.summary,
    );
    expect(
      [...row.querySelectorAll("[data-icon]")].map((el) =>
        el.getAttribute("data-icon"),
      ),
    ).toStrictEqual(["file-text", "external-link", "chevron-right"]);
  });

  it("keeps a numeric style's gutter when every Item was omitted", async () => {
    const container = await render(
      [
        {
          id: "BOOK0001",
          refNumber: 1,
          occurrences: [occurrence],
          kind: "unrendered",
          source,
          linkpath: "notes/BOOK0001",
        },
      ],
      { kind: "bibliography", hasEntryMarkers: true },
    );

    expect(container.querySelector("ul")!.classList).toContain(
      "zt:grid-cols-[max-content_minmax(0,1fr)_max-content]",
    );
    expect(container.querySelector("li")!.children[0]!.textContent).toBe("⚠");
  });

  it("uses Reference Numbers and warnings in the minimal list", async () => {
    const container = await render(
      [
        {
          id: "BOOK0001",
          refNumber: 1,
          occurrences: [occurrence],
          kind: "summary",
          source,
          linkpath: "notes/BOOK0001",
        },
        {
          id: "GONE0002",
          refNumber: 2,
          occurrences: [occurrence],
          kind: "missing",
          linkpath: "notes/GONE0002",
        },
      ],
      { kind: "minimal" },
    );

    const rows = container.querySelectorAll("li");
    expect(rows[0]!.children[0]!.textContent).toBe("1");
    expect(rows[1]!.children[0]!.textContent).toBe("⚠");
  });

  it("shows a malformed Citation Fragment as an unnumbered Reference Error", async () => {
    const container = await render(
      [
        {
          id: "malformed:0",
          occurrences: [{ ...occurrence, kind: "wikilink" }],
          kind: "malformed",
        },
      ],
      { kind: "minimal" },
    );

    const row = container.querySelector("li")!;
    expect(row.children[0]!.textContent).toBe("⚠");
    expect(row.textContent).toContain(
      "This link has an invalid citation fragment.",
    );
    expect(
      row.querySelector('[data-icon="file-text"]')?.hasAttribute("disabled"),
    ).toBe(true);
    expect(
      row
        .querySelector('[data-icon="chevron-right"]')
        ?.hasAttribute("disabled"),
    ).toBe(false);
  });

  it("shows a visible error above the current minimal list after formatting fails", async () => {
    const container = await render(
      [
        {
          id: "BOOK0001",
          refNumber: 1,
          occurrences: [occurrence],
          kind: "summary",
          source,
          linkpath: "notes/BOOK0001",
        },
      ],
      { kind: "minimal" },
      { formattingFailed: true },
    );

    expect(container.textContent).toContain(
      "ZotLit could not format these references",
    );
    expect(container.textContent).toContain("Rivers (2020): Book");
    expect(container.querySelector("li")!.children[0]!.textContent).toBe("1");
  });
});

describe("References toolbar", () => {
  const summaryEntry: ReferenceEntry = {
    id: "BOOK0001",
    refNumber: 1,
    occurrences: [occurrence],
    kind: "summary",
    source,
    linkpath: "notes/BOOK0001",
  };

  function styleAction(container: HTMLElement): HTMLElement {
    return container.querySelector<HTMLElement>(
      "[data-references-change-style]",
    )!;
  }

  it("holds the style action above the scrolling list region", async () => {
    const container = await render([summaryEntry], { kind: "minimal" });
    const scrolling = container.querySelector("[data-references-scroll]")!;

    expect(styleAction(container)).not.toBeNull();
    expect(
      scrolling.querySelector("[data-references-change-style]"),
    ).toBeNull();
    expect(scrolling.querySelector("ul")).not.toBeNull();
  });

  it("names the style action for pointer and keyboard users", async () => {
    const container = await render([summaryEntry], { kind: "minimal" });

    expect(styleAction(container).getAttribute("aria-label")).toBe(
      "Change citation and references style",
    );
  });

  it("reveals the style setting when the action is activated", async () => {
    const container = await render([summaryEntry], { kind: "minimal" });
    await act(() => styleAction(container).click());

    expect(actions.onChangeStyle).toHaveBeenCalledTimes(1);
  });

  it("keeps the style action live when the note cites nothing", async () => {
    const container = await render([], { kind: "minimal" });

    expect(container.querySelector("[data-references-empty]")).not.toBeNull();
    expect(styleAction(container).hasAttribute("disabled")).toBe(false);
  });

  it("keeps the style action live while the engine is unavailable", async () => {
    const container = await render(
      [summaryEntry],
      { kind: "minimal" },
      {
        engine: { kind: "absent" },
      },
    );

    expect(styleAction(container).hasAttribute("disabled")).toBe(false);
  });

  it("keeps the style action live after formatting failed", async () => {
    const container = await render(
      [summaryEntry],
      {
        kind: "minimal",
      },
      { formattingFailed: true },
    );

    expect(styleAction(container).hasAttribute("disabled")).toBe(false);
  });
});
