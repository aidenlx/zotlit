// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ambiguousCandidates } from "@/services/citation-index/__fixtures__/ambiguous-candidates";
import type {
  CitationOccurrence,
  ReferenceSource,
} from "@/services/citation-index/service";

import type { ReferenceActions } from "./actions";
import type { ReferenceEntry } from "./entries";
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
  onCopyBibliography: vi.fn(() => Promise.resolve()),
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
  citekey: "rivers2020",
  linkpath: "notes/BOOK0001",
  attachments: [],
};

let state: ReferencesState;
let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function render(
  entries: readonly ReferenceEntry[],
  listMode: ReferencesListMode,
  {
    formattingFailed = false,
    documentPresentationError = null,
    engine = { kind: "installed", version: "test" },
    copy = { kind: "blocked", reason: "pending" },
  }: Partial<
    Pick<
      ReferencesState,
      "formattingFailed" | "documentPresentationError" | "engine" | "copy"
    >
  > = {},
): Promise<HTMLElement> {
  state = {
    entries,
    listMode,
    engine,
    formattingFailed,
    documentPresentationError,
    dbReady: true,
    copy,
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
      { kind: "bibliography", hasEntryMarkers: false, entrySerials: false },
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
    const container = await render(
      [
        {
          id: "BOOK0001",
          refNumber: 1,
          occurrences: [occurrence],
          kind: "rendered",
          source,
          linkpath: "notes/BOOK0001",
          serial: 1,
          marker: [{ t: "Str", c: "[1]" }],
          content: [
            { t: "Str", c: "Rendered" },
            { t: "Space" },
            { t: "Str", c: "book" },
          ],
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
      { kind: "bibliography", hasEntryMarkers: true, entrySerials: false },
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

  it("shows the markup and the links a formatted entry carries", async () => {
    const container = await render(
      [
        {
          id: "BOOK0001",
          refNumber: 1,
          occurrences: [occurrence],
          kind: "rendered",
          source,
          linkpath: "notes/BOOK0001",
          serial: 1,
          marker: undefined,
          content: [
            {
              t: "Emph",
              c: [
                { t: "Str", c: "Field" },
                { t: "Space" },
                { t: "Str", c: "notes" },
              ],
            },
            { t: "Str", c: "." },
            { t: "Space" },
            {
              t: "Link",
              c: [
                ["", [], []],
                [{ t: "Str", c: "https://doi.org/10.1000/182" }],
                ["https://doi.org/10.1000/182", ""],
              ],
            },
          ],
        },
      ],
      { kind: "bibliography", hasEntryMarkers: false, entrySerials: false },
    );

    const row = container.querySelector("li")!;
    expect(row.querySelector("em")?.textContent).toBe("Field notes");
    // A bare anchor, which Obsidian itself opens in the system browser.
    const link = row.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("https://doi.org/10.1000/182");
    expect(link.getAttributeNames()).toStrictEqual(["href"]);
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
      { kind: "bibliography", hasEntryMarkers: true, entrySerials: false },
    );

    expect(container.querySelector("ul")!.classList).toContain(
      "zt:grid-cols-[max-content_minmax(0,1fr)_max-content]",
    );
    expect(container.querySelector("li")!.children[0]!.textContent).toBe("⚠");
  });

  // A note-class style writes no Entry Marker, so the gutter carries the Entry
  // Serials the document's own citations show.
  it("shows Entry Serials in the gutter of a document that shows them", async () => {
    const container = await render(
      [
        {
          id: "BOOK0001",
          refNumber: 2,
          occurrences: [occurrence],
          kind: "rendered",
          source,
          linkpath: "notes/BOOK0001",
          serial: 1,
          marker: undefined,
          content: [{ t: "Str", c: "Zeta." }],
        },
        {
          id: "BOOK0002",
          refNumber: 1,
          occurrences: [occurrence],
          kind: "rendered",
          source,
          linkpath: "notes/BOOK0002",
          serial: 2,
          marker: undefined,
          content: [{ t: "Str", c: "Rivers." }],
        },
        {
          id: "GONE0003",
          refNumber: 3,
          occurrences: [occurrence],
          kind: "missing",
          linkpath: "notes/GONE0003",
        },
      ],
      { kind: "bibliography", hasEntryMarkers: false, entrySerials: true },
    );

    const rows = container.querySelectorAll("li");
    expect(container.querySelector("ul")!.classList).toContain(
      "zt:grid-cols-[max-content_minmax(0,1fr)_max-content]",
    );
    expect([...rows].map((row) => row.children[0]!.textContent)).toEqual([
      "1",
      "2",
      "⚠",
    ]);
  });

  it("keeps the Entry Marker in the gutter of a style that writes one", async () => {
    const container = await render(
      [
        {
          id: "BOOK0001",
          refNumber: 1,
          occurrences: [occurrence],
          kind: "rendered",
          source,
          linkpath: "notes/BOOK0001",
          serial: 1,
          marker: [{ t: "Str", c: "[7]" }],
          content: [{ t: "Str", c: "Zeta." }],
        },
      ],
      { kind: "bibliography", hasEntryMarkers: true, entrySerials: true },
    );

    expect(container.querySelector("li")!.children[0]!.textContent).toBe("[7]");
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

  it("shows an ambiguous citekey's candidates and disables its note action", async () => {
    const container = await render(
      [
        {
          id: "@doe2024",
          refNumber: 1,
          occurrences: [occurrence],
          kind: "ambiguous",
          citekey: "doe2024",
          candidates: ambiguousCandidates,
        },
      ],
      { kind: "minimal" },
    );

    const row = container.querySelector("li")!;
    expect(row.children[0]!.textContent).toBe("⚠");
    expect(row.textContent).toContain(
      "@doe2024 matches multiple items in your Zotero library.",
    );
    // Item summary, Library name, and bare Zotero key: the three facts that
    // tell two candidates of one Library apart.
    const rows = [...row.querySelectorAll("li")];
    expect(rows.map((el) => el.textContent)).toStrictEqual([
      "Doe (2024): A study of citationsMy LibraryDOE2024A",
      "Doe (2024): Another studyShared groupDOE2024B",
    ]);
    expect(
      row.querySelector('[data-icon="file-text"]')?.hasAttribute("disabled"),
    ).toBe(true);
    // The citations are still in the document, so jumping to them stands.
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

describe("References banners", () => {
  const summaryEntry: ReferenceEntry = {
    id: "BOOK0001",
    refNumber: 1,
    occurrences: [occurrence],
    kind: "summary",
    source,
    linkpath: "notes/BOOK0001",
  };

  /**
   * Inside the scrolling region, so a banner travels with the list it
   * describes and the toolbar above keeps its own place.
   */
  it.each([
    [
      "the install hint",
      { engine: { kind: "absent" } } satisfies Partial<ReferencesState>,
      "Format these references",
    ],
    [
      "the install progress",
      {
        engine: { kind: "installing", done: Promise.resolve() },
      } satisfies Partial<ReferencesState>,
      "Downloading the Pandoc engine…",
    ],
    [
      "an engine failure",
      {
        engine: {
          kind: "failed",
          failure: { code: "hash-mismatch", expected: "a", actual: "b" },
        },
      } satisfies Partial<ReferencesState>,
      "The Pandoc engine is unavailable",
    ],
    [
      "a formatting failure",
      { formattingFailed: true } satisfies Partial<ReferencesState>,
      "ZotLit could not format these references",
    ],
    [
      "an unusable note style",
      {
        documentPresentationError: { kind: "unusable", property: "style" },
      } satisfies Partial<ReferencesState>,
      "This note's citation and references style is unavailable",
    ],
    [
      "an unusable document language",
      {
        documentPresentationError: {
          kind: "unusable",
          property: "language",
        },
      } satisfies Partial<ReferencesState>,
      "This note's document language is invalid",
    ],
    [
      "an unavailable Imported Note Profile",
      {
        documentPresentationError: {
          kind: "unusable",
          property: "profile",
          diagnostic: {
            code: "unknown-literature-note-profile",
            hint: "Re-stamp the note or recreate the Profile with the same ID.",
            stamp: "deleted-profile",
          },
          target: "Imported/Research.md",
        },
      } satisfies Partial<ReferencesState>,
      "This imported note's profile is unavailable",
    ],
    [
      "an unavailable Imported Note Profile style",
      {
        documentPresentationError: {
          kind: "unusable",
          property: "profile-style",
          styleId: "missing-profile-style",
          profileId: "research-profile",
          target: "Imported/Research.md",
        },
      } satisfies Partial<ReferencesState>,
      "This imported note's profile style is unavailable",
    ],
  ])("keeps %s with the scrolling list region", async (_, state, title) => {
    const container = await render([summaryEntry], { kind: "minimal" }, state);
    const banner = container.querySelector("[data-references-banner]");

    expect(banner?.textContent).toContain(title);
    expect(
      container.querySelector("[data-references-scroll]")!.contains(banner),
    ).toBe(true);
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

  /**
   * The action counts as live when activating it still reaches the reveal:
   * a disabled icon button swallows its own click, so the reveal stays
   * uncalled.
   */
  async function activateStyleAction(container: HTMLElement): Promise<void> {
    await act(() => styleAction(container).click());
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
    await activateStyleAction(container);

    expect(actions.onChangeStyle).toHaveBeenCalledTimes(1);
  });

  it("keeps the style action live when the note cites nothing", async () => {
    const container = await render([], { kind: "minimal" });

    expect(container.querySelector("[data-references-empty]")).not.toBeNull();
    await activateStyleAction(container);

    expect(actions.onChangeStyle).toHaveBeenCalledTimes(1);
  });

  it("keeps the style action live while the engine is still installing", async () => {
    const container = await render(
      [summaryEntry],
      { kind: "minimal" },
      {
        engine: { kind: "installing", done: Promise.resolve() },
      },
    );
    await activateStyleAction(container);

    expect(actions.onChangeStyle).toHaveBeenCalledTimes(1);
  });

  it("keeps the style action live while the engine is unavailable", async () => {
    const container = await render(
      [summaryEntry],
      { kind: "minimal" },
      {
        engine: { kind: "absent" },
      },
    );
    await activateStyleAction(container);

    expect(actions.onChangeStyle).toHaveBeenCalledTimes(1);
  });

  it("keeps the style action live after formatting failed", async () => {
    const container = await render(
      [summaryEntry],
      {
        kind: "minimal",
      },
      { formattingFailed: true },
    );
    await activateStyleAction(container);

    expect(actions.onChangeStyle).toHaveBeenCalledTimes(1);
  });

  it("keeps the style action live while copying is unavailable", async () => {
    const container = await render(
      [summaryEntry],
      { kind: "minimal" },
      {
        copy: { kind: "blocked", reason: "errors" },
      },
    );
    await activateStyleAction(container);

    expect(actions.onChangeStyle).toHaveBeenCalledTimes(1);
  });
});

describe("References copy action", () => {
  const renderedEntry: ReferenceEntry = {
    id: "BOOK0001",
    refNumber: 1,
    occurrences: [occurrence],
    kind: "rendered",
    source,
    linkpath: "notes/BOOK0001",
    serial: 1,
    marker: [{ t: "Str", c: "[1]" }],
    content: [{ t: "Str", c: "Book" }],
  };

  function copyAction(container: HTMLElement): HTMLElement {
    return container.querySelector<HTMLElement>(
      "[data-references-copy-bibliography]",
    )!;
  }

  const target = { path: "notes/tidal.md", generation: 7 };

  async function ready(): Promise<HTMLElement> {
    return render(
      [renderedEntry],
      { kind: "bibliography", hasEntryMarkers: true, entrySerials: false },
      { copy: { kind: "ready", target } },
    );
  }

  it("holds the copy action above the scrolling list region", async () => {
    const container = await ready();
    const scrolling = container.querySelector("[data-references-scroll]")!;

    expect(copyAction(container)).not.toBeNull();
    expect(
      scrolling.querySelector("[data-references-copy-bibliography]"),
    ).toBeNull();
  });

  it("names the copy action for pointer and keyboard users", async () => {
    const container = await ready();
    const action = copyAction(container);

    expect(action.getAttribute("aria-label")).toBe("Copy bibliography");
    expect(action.hasAttribute("disabled")).toBe(false);
  });

  it("copies the bibliography the action was offered for", async () => {
    const container = await ready();
    await act(() => copyAction(container).click());

    expect(actions.onCopyBibliography).toHaveBeenCalledExactlyOnceWith(target);
  });

  it.each([
    ["no-note", "Open a note to copy its bibliography"],
    ["no-references", "The active note cites nothing to copy"],
    ["pending", "Wait for the references to finish formatting"],
    ["unavailable", "Bibliography formatting is unavailable"],
    ["failed", "Bibliography formatting failed"],
    ["errors", "Fix the reference errors to copy the bibliography"],
  ] as const)(
    "explains why copying is unavailable: %s",
    async (reason, tooltip) => {
      const container = await render(
        [renderedEntry],
        { kind: "bibliography", hasEntryMarkers: true, entrySerials: false },
        { copy: { kind: "blocked", reason } },
      );
      const action = copyAction(container);

      expect(action.getAttribute("aria-label")).toBe(tooltip);
      expect(action.hasAttribute("disabled")).toBe(true);

      await act(() => action.click());
      expect(actions.onCopyBibliography).not.toHaveBeenCalled();
    },
  );
});
