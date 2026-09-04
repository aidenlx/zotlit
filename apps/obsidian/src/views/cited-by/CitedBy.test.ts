// @vitest-environment happy-dom
import { Menu } from "@mock/obsidian";
import { Keymap, MarkdownView, TFile } from "obsidian";
import type {
  App,
  CachedMetadata,
  LinkCache,
  ListItemCache,
  Loc,
  Pos,
  SectionCache,
  WorkspaceLeaf,
} from "obsidian";
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { yieldToMain } from "@/lib/yield-to-main";
import type {
  CitedByGroup,
  CitedBySnapshot,
} from "@/services/citation-index/service";

import { CitedByActionsContext, createCitedByActions } from "./actions";
import { CitedBy } from "./CitedBy";
import { COMPACT_CAP, createCitedByStore, CitedByStoreProvider } from "./store";

vi.mock("zustand", () => import("../__fixtures__/zustand"));

const body = "A reason cites @doe2024 here.\n";
const start = body.indexOf("@doe2024");
const group: CitedByGroup = {
  path: "Notes/draft.md",
  occurrences: [
    {
      kind: "citekey",
      raw: "doe2024",
      position: {
        start: { line: 0, col: start, offset: start },
        end: { line: 0, col: start + 8, offset: start + 8 },
      },
    },
  ],
};

const multiBody = "Alpha cites @doe2024 here.\nBeta cites @doe2024 there.\n";
const multiGroup: CitedByGroup = {
  path: group.path,
  occurrences: [
    multiBody.indexOf("@doe2024"),
    multiBody.lastIndexOf("@doe2024"),
  ].map((offset, line) => ({
    kind: "citekey",
    raw: "doe2024",
    position: {
      start: { line, col: 0, offset },
      end: { line, col: 8, offset: offset + 8 },
    },
  })),
};

function locAt(source: string, offset: number): Loc {
  const before = source.slice(0, offset);
  return {
    line: before.split("\n").length - 1,
    col: offset - (before.lastIndexOf("\n") + 1),
    offset,
  };
}

/** Where one fixture body carries a given piece of text. */
function span(source: string, text: string): Pos {
  const offset = source.indexOf(text);
  return {
    start: locAt(source, offset),
    end: locAt(source, offset + text.length),
  };
}

/** The group of the single `@doe2024` citation of one fixture body. */
function citedIn(source: string): CitedByGroup {
  return {
    path: group.path,
    occurrences: [
      { kind: "citekey", raw: "doe2024", position: span(source, "@doe2024") },
    ],
  };
}

const paragraphBody =
  "Intro line.\n\nA reason cites @doe2024 here.\nSecond line of the block.\n";
const paragraphSections: SectionCache[] = [
  { type: "paragraph", position: span(paragraphBody, "Intro line.") },
  {
    type: "paragraph",
    position: span(
      paragraphBody,
      "A reason cites @doe2024 here.\nSecond line of the block.",
    ),
  },
];

const listBody =
  "- Alpha cites @doe2024 here.\n  - Nested detail.\n- Beta item.\n";
const listSections: SectionCache[] = [
  {
    type: "list",
    position: span(
      listBody,
      "- Alpha cites @doe2024 here.\n  - Nested detail.\n- Beta item.",
    ),
  },
];
const listItems: ListItemCache[] = [
  { parent: -1, position: span(listBody, "- Alpha cites @doe2024 here.") },
  { parent: 0, position: span(listBody, "- Nested detail.") },
  { parent: -1, position: span(listBody, "- Beta item.") },
];

const headingBody = "# Heading cites @doe2024 here\n\nBody paragraph.\n";
const headingSections: SectionCache[] = [
  {
    type: "heading",
    position: span(headingBody, "# Heading cites @doe2024 here"),
  },
  { type: "paragraph", position: span(headingBody, "Body paragraph.") },
];

/** A citing note whose citation has a logical chunk on either side of it. */
const expansionBody =
  "# Overview\n\nIntro paragraph.\n\n- Alpha cites @doe2024 here.\n  - Nested detail.\n- Beta item.\n\nClosing paragraph.\n";
const expansionSections: SectionCache[] = [
  { type: "heading", position: span(expansionBody, "# Overview") },
  { type: "paragraph", position: span(expansionBody, "Intro paragraph.") },
  {
    type: "list",
    position: span(
      expansionBody,
      "- Alpha cites @doe2024 here.\n  - Nested detail.\n- Beta item.",
    ),
  },
  { type: "paragraph", position: span(expansionBody, "Closing paragraph.") },
];
const expansionListItems: ListItemCache[] = [
  { parent: -1, position: span(expansionBody, "- Alpha cites @doe2024 here.") },
  { parent: 4, position: span(expansionBody, "- Nested detail.") },
  { parent: -1, position: span(expansionBody, "- Beta item.") },
];

/**
 * A citing note with a line long enough to trigger the compact-excerpt cap.
 * The padding on each side exceeds {@link COMPACT_CAP}, so compact mode clips
 * the line and the "show more context" toggle reveals the full paragraph.
 * Spaces separate the padding from the citekey so the scanner recognises it.
 */
const longParagraph = `${"x ".repeat(COMPACT_CAP)}@doe2024${" y".repeat(COMPACT_CAP)}`;
const longLineBody = `Preamble.\n\n${longParagraph}\n\nEpilogue.\n`;
const longLineSections: SectionCache[] = [
  { type: "paragraph", position: span(longLineBody, "Preamble.") },
  { type: "paragraph", position: span(longLineBody, longParagraph) },
  { type: "paragraph", position: span(longLineBody, "Epilogue.") },
];

/** Three citing notes in vault-path order, two of them sharing a name. */
const sortedGroups: CitedByGroup[] = [
  { ...group, path: "A/beta.md" },
  { ...group, path: "B/alpha.md" },
  { ...group, path: "C/alpha.md" },
];

/** Vault times that give each time mode an order of its own. */
const sortedStats: Record<string, { ctime: number; mtime: number }> = {
  "A/beta.md": { ctime: 3, mtime: 2 },
  "B/alpha.md": { ctime: 1, mtime: 3 },
  "C/alpha.md": { ctime: 2, mtime: 1 },
};

let root: Root | undefined;

/** Settles awaited work without letting a macrotask yield run. */
async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function snapshot(overrides: Partial<CitedBySnapshot> = {}): CitedBySnapshot {
  return {
    groups: [group],
    coverage: "complete",
    resolution: "fresh",
    ...overrides,
  };
}

function makeFile(
  path: string = group.path,
  stats: { ctime: number; mtime: number } = { ctime: 0, mtime: 1 },
): TFile {
  const file = new TFile();
  const name = path.slice(path.lastIndexOf("/") + 1);
  file.path = path;
  file.name = name;
  file.basename = name.slice(0, -".md".length);
  file.extension = "md";
  file.stat = { ...stats, size: body.length };
  return file;
}

async function render(options: {
  indexedKey?: string | null;
  snapshot?: CitedBySnapshot;
  read?: (file: TFile) => Promise<string>;
  collapsed?: boolean;
  activePath?: string | null;
  search?: string;
  searchVisible?: boolean;
  links?: LinkCache[];
  sections?: SectionCache[];
  listItems?: ListItemCache[];
  duplicateSourceLeaf?: boolean;
  stats?: Readonly<Record<string, { ctime: number; mtime: number }>>;
  /** Citing notes the snapshot still holds whose file left the vault. */
  missingPaths?: readonly string[];
}) {
  const shown = options.snapshot ?? snapshot();
  const files = new Map(
    shown.groups
      .filter(({ path }) => !options.missingPaths?.includes(path))
      .map(
        ({ path }) => [path, makeFile(path, options.stats?.[path])] as const,
      ),
  );
  const file = files.get(group.path) ?? makeFile();
  const read = vi.fn(options.read ?? (() => Promise.resolve(body)));
  const openLinkText = vi.fn(() => Promise.resolve());
  const setEphemeralState = vi.fn();
  const markdownView = new MarkdownView({} as WorkspaceLeaf);
  Object.assign(markdownView, { file, setEphemeralState });
  const sourceLeaf = { view: markdownView } as unknown as WorkspaceLeaf;
  const oldSetEphemeralState = vi.fn();
  const oldMarkdownView = new MarkdownView({} as WorkspaceLeaf);
  Object.assign(oldMarkdownView, {
    file,
    setEphemeralState: oldSetEphemeralState,
  });
  const oldSourceLeaf = {
    view: oldMarkdownView,
  } as unknown as WorkspaceLeaf;
  const setActiveLeaf = vi.fn();
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      cachedRead: read,
    },
    metadataCache: {
      getFileCache: () =>
        ({
          links: options.links ?? [],
          sections: options.sections,
          listItems: options.listItems,
        }) as CachedMetadata,
    },
    workspace: {
      activeLeaf: sourceLeaf,
      openLinkText,
      getLeavesOfType: () =>
        options.duplicateSourceLeaf
          ? [oldSourceLeaf, sourceLeaf]
          : [sourceLeaf],
      setActiveLeaf,
    },
  } as unknown as App;
  const store = createCitedByStore();
  store.setState({
    indexedKey:
      options.indexedKey === undefined ? "ABCD2345" : options.indexedKey,
    snapshot: shown,
    collapsed: options.collapsed ? [group.path] : [],
    activePath: options.activePath ?? null,
    search: options.search ?? "",
    searchVisible: options.searchVisible ?? false,
  });
  const actions = createCitedByActions({ app, store });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(
        CitedByStoreProvider,
        { value: store },
        createElement(
          CitedByActionsContext,
          { value: actions },
          createElement(CitedBy),
        ),
      ),
    );
    await Promise.resolve();
  });
  return {
    actions,
    app,
    container,
    file,
    openLinkText,
    oldSetEphemeralState,
    read,
    setActiveLeaf,
    setEphemeralState,
    store,
  };
}

/** The source-group labels, in the order the sidebar shows them. */
function sourceLabels(container: Element): (string | null)[] {
  return [...container.querySelectorAll("[data-cited-by-source-label]")].map(
    (label) => label.textContent,
  );
}

async function openSortMenu(container: Element): Promise<Menu> {
  Menu.instances.length = 0;
  await act(() =>
    (container.querySelector("[data-cited-by-sort]") as HTMLElement).click(),
  );
  const menu = Menu.instances.at(-1);
  if (!menu) throw new Error("the sort action opened no menu");
  return menu;
}

/** Activate the chevron on one side of the first occurrence card. */
async function expandContext(
  container: Element,
  direction: "before" | "after",
): Promise<void> {
  const chevron = container.querySelector(
    `[data-cited-by-expand="${direction}"]`,
  );
  if (!chevron) throw new Error(`no card offers more context ${direction} it`);
  await act(() => (chevron as HTMLElement).click());
}

/** Open the sort menu and pick the mode of one title. */
async function chooseSort(container: Element, title: string): Promise<void> {
  const menu = await openSortMenu(container);
  const item = menu.items.find((entry) => entry.title === title);
  if (!item) throw new Error(`the sort menu offers no "${title}"`);
  await act(() => item.click());
}

describe("CitedBy", () => {
  it("asks for a literature note outside the Literature Note context", async () => {
    const { container } = await render({ indexedKey: null });
    expect(container.querySelector("[data-cited-by-empty]")?.textContent).toBe(
      "Open a literature note to see citations.",
    );
    expect(container.querySelector(".pane-empty")).toBeNull();
  });

  it("keeps partial results visible while indexing", async () => {
    const { container } = await render({
      snapshot: snapshot({ coverage: "indexing" }),
    });
    expect(container.textContent).toContain("Indexing citations…");
    expect(container.textContent).toContain("draft");
    expect(container.querySelector('[role="status"]')?.classList).toContain(
      "zt:bg-muted",
    );
    expect(container.querySelector("[data-cited-by-empty]")).toBeNull();
  });

  it("distinguishes degraded coverage and citation-key resolution", async () => {
    const { container } = await render({
      snapshot: snapshot({
        coverage: "degraded",
        resolution: "failed",
      }),
    });
    expect(container.textContent).toContain("Some notes could not be indexed.");
    expect(container.textContent).toContain(
      "Some citations that use citation keys may be unavailable.",
    );
    expect(container.textContent).toContain("draft");
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it("shows degraded resolution instead of a final empty result", async () => {
    const { container } = await render({
      snapshot: snapshot({
        groups: [],
        coverage: "complete",
        resolution: "failed",
      }),
    });

    expect(container.textContent).toContain(
      "Some citations that use citation keys may be unavailable.",
    );
    expect(container.textContent).not.toContain(
      "No notes cite this literature note.",
    );
    expect(container.querySelector("[data-cited-by-empty]")).not.toBeNull();
  });

  it("shows that citation-key resolution is still in progress", async () => {
    const { container } = await render({
      snapshot: snapshot({
        groups: [],
        coverage: "complete",
        resolution: null,
      }),
    });

    expect(container.textContent).toContain("Resolving citations…");
    expect(container.textContent).not.toContain(
      "No notes cite this literature note.",
    );
    expect(container.querySelector("[data-cited-by-empty]")).not.toBeNull();
  });

  it("shows the final empty result after complete ready coverage", async () => {
    const { container } = await render({
      snapshot: snapshot({ groups: [], coverage: "complete" }),
    });

    expect(container.querySelector("[data-cited-by-empty]")?.textContent).toBe(
      "No notes cite this literature note.",
    );
  });

  it("moves from reset progress to its final truthful state", async () => {
    const { container, store } = await render({});

    await act(() =>
      store.setState({
        snapshot: snapshot({ coverage: "indexing" }),
      }),
    );
    expect(container.textContent).toContain("Indexing citations…");
    expect(container.textContent).toContain("draft");

    await act(() =>
      store.setState({
        snapshot: snapshot({ groups: [], coverage: "complete" }),
      }),
    );
    expect(container.querySelector("[data-cited-by-empty]")?.textContent).toBe(
      "No notes cite this literature note.",
    );
  });

  it("reads context for a collapsed group, then expands it without a load wait", async () => {
    const { actions, container, read } = await render({ collapsed: true });
    await act(async () => Promise.resolve());
    expect(read).toHaveBeenCalledOnce();
    expect(container.querySelector("[data-occurrence]")).toBeNull();

    await act(() => actions.expandAll());
    expect(read).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("A reason cites @doe2024 here.");
    expect(container.querySelector("mark")?.textContent).toBe("@doe2024");

    await act(async () => {
      actions.collapseAll();
      actions.expandAll();
      await Promise.resolve();
    });
    expect(read).toHaveBeenCalledOnce();
  });

  it("streams every group one read at a time, yielding between batches", async () => {
    const groups: CitedByGroup[] = Array.from({ length: 7 }, (_, index) => ({
      ...group,
      path: `Notes/source-${index}.md`,
    }));
    const paths = groups.map(({ path }) => path);
    const pendingReads: ((source: string) => void)[] = [];
    const { container, read } = await render({
      snapshot: snapshot({ groups }),
      read: () =>
        new Promise<string>((resolve) => {
          pendingReads.push(resolve);
        }),
    });
    const readPaths = () => read.mock.calls.map(([file]) => file.path);
    const finishReads = async (count: number) => {
      await act(async () => {
        for (let done = 0; done < count; done += 1) {
          pendingReads.shift()?.(body);
          await flushMicrotasks();
        }
      });
    };

    await act(flushMicrotasks);
    expect(readPaths()).toEqual(paths.slice(0, 1));

    await finishReads(5);
    expect(readPaths()).toEqual(paths.slice(0, 5));

    await act(async () => yieldToMain());
    expect(readPaths()).toEqual(paths.slice(0, 6));

    await finishReads(2);
    await act(async () => yieldToMain());
    expect(readPaths()).toEqual(paths);
    expect(container.querySelectorAll("[data-occurrence]")).toHaveLength(7);
  });

  it("stops streaming once the view is gone", async () => {
    const pendingReads: ((source: string) => void)[] = [];
    const { read } = await render({
      snapshot: snapshot({
        groups: [group, { ...group, path: "Notes/other.md" }],
      }),
      read: () =>
        new Promise<string>((resolve) => {
          pendingReads.push(resolve);
        }),
    });
    await act(flushMicrotasks);
    expect(read).toHaveBeenCalledOnce();

    await act(() => root?.unmount());
    root = undefined;
    await act(async () => {
      pendingReads.shift()?.(body);
      await flushMicrotasks();
    });

    expect(read).toHaveBeenCalledOnce();
  });

  it("invalidates cached context when the note modification time changes", async () => {
    const { actions, file, read } = await render({});
    await act(async () => Promise.resolve());
    expect(read).toHaveBeenCalledOnce();

    file.stat = { ...file.stat, mtime: 2 };
    await act(async () => {
      actions.invalidatePreview(file.path);
      await Promise.resolve();
    });

    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps the source group when its preview is unavailable", async () => {
    const { container } = await render({
      read: () => Promise.reject(new Error("unreadable")),
    });
    expect(container.textContent).toContain("draft");
    expect(container.textContent).toContain("Preview unavailable");
    const warning = container.querySelector(
      '[class~="zt:text-(--text-error)"]',
    );
    expect(warning?.textContent).toContain("Preview unavailable");
  });

  it("owns the Backlinks-style result presentation", async () => {
    const { container } = await render({});
    const result = container.querySelector("[data-cited-by-result]");
    const results = container.querySelector("[data-cited-by-results]");
    const header = result?.querySelector("[data-cited-by-source-header]");
    const open = result?.querySelector("[data-source]");
    const occurrence = result?.querySelector("[data-occurrence]");

    expect(result).not.toBeNull();
    expect(
      result?.matches(".tree-item, .search-result") ||
        result?.querySelector(
          ".tree-item-self, .tree-item-inner, .tree-item-flair, .search-result-file-matches, .search-result-file-match",
        ),
    ).toBeFalsy();
    expect(results?.classList).toContain("zt:px-3");
    expect(header?.classList).toContain("zt:p-(--nav-item-padding)");
    expect(header?.classList).toContain("zt:pe-0");
    expect(header?.classList).toContain("zt:items-center");
    expect(open?.classList).toContain("zt:size-5");
    expect(open?.classList).not.toContain("clickable-icon");
    expect(occurrence?.classList).toContain("zt:hover:bg-(--text-selection)");
    expect(result?.querySelector("mark")?.classList).toContain(
      "zt:bg-(--text-highlight-bg)",
    );
  });

  it("renders every occurrence as a search-result card", async () => {
    const { container } = await render({});
    const card = container.querySelector("[data-occurrence]");
    const cards = container.querySelector("[data-cited-by-cards]");

    expect(card?.parentElement).toBe(cards);
    expect(cards?.classList).toContain("zt:bg-(--search-result-background)");
    expect(cards?.classList).toContain(
      "zt:shadow-[0_0_0_var(--border-width)_var(--background-modifier-border)]",
    );
    expect(cards?.classList).toContain("zt:rounded-(--radius-s)");
    expect(card?.classList).toContain(
      "zt:border-(--background-modifier-border)",
    );
    expect(card?.classList).toContain("zt:hover:bg-(--text-selection)");
    expect(card?.classList).toContain("zt:focus-visible:bg-(--text-selection)");
    expect(card?.classList).toContain(
      "zt:focus-visible:shadow-[inset_0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)]",
    );
  });

  it("highlights the citation inside its surrounding context", async () => {
    const { container } = await render({});
    const card = container.querySelector("[data-occurrence]");
    const highlight = card?.querySelector("mark");

    expect(card?.textContent).toBe("A reason cites @doe2024 here.");
    expect(highlight?.textContent).toBe("@doe2024");
    expect(highlight?.previousSibling?.textContent).toBe("A reason cites ");
    expect(highlight?.nextSibling?.textContent).toBe(" here.");
  });

  it("activates card navigation from the keyboard and from a mod-click", async () => {
    const { container, openLinkText, setEphemeralState } = await render({});
    const card = container.querySelector("[data-occurrence]") as HTMLElement;

    await act(() => {
      card.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await act(async () => Promise.resolve());
    expect(openLinkText).toHaveBeenLastCalledWith(group.path, "", false);
    expect(setEphemeralState).toHaveBeenCalledOnce();

    vi.spyOn(Keymap, "isModEvent").mockReturnValue("tab");
    await act(() => card.click());
    await act(async () => Promise.resolve());
    expect(openLinkText).toHaveBeenLastCalledWith(group.path, "", "tab");
    expect(setEphemeralState).toHaveBeenCalledTimes(2);
  });

  it("toggles a source row and opens its note from the dedicated button", async () => {
    vi.spyOn(Keymap, "isModEvent").mockReturnValue("tab");
    const { container, openLinkText } = await render({});
    const toggle = container.querySelector(
      "[data-cited-by-source-toggle]",
    ) as HTMLElement;

    await act(() => toggle.click());
    expect(container.querySelector("[data-occurrence]")).toBeNull();
    expect(openLinkText).not.toHaveBeenCalled();

    await act(() => toggle.click());
    await act(async () => Promise.resolve());
    expect(container.querySelector("[data-occurrence]")).not.toBeNull();

    await act(() =>
      (
        container.querySelector('[data-source="Notes/draft.md"]') as HTMLElement
      ).click(),
    );

    expect(openLinkText).toHaveBeenCalledWith("Notes/draft.md", "", "tab");
    expect(container.querySelector("[data-occurrence]")).not.toBeNull();
    expect(container.querySelector("[data-source] svg")?.classList).toContain(
      "lucide-arrow-up-right",
    );
  });

  it("reveals the new modifier-click leaf when the source was already open", async () => {
    vi.spyOn(Keymap, "isModEvent").mockReturnValue("tab");
    const {
      container,
      oldSetEphemeralState,
      setActiveLeaf,
      setEphemeralState,
    } = await render({ duplicateSourceLeaf: true });

    await act(() =>
      (container.querySelector("[data-occurrence]") as HTMLElement).click(),
    );
    await act(async () => Promise.resolve());

    expect(setEphemeralState).toHaveBeenCalledOnce();
    expect(oldSetEphemeralState).not.toHaveBeenCalled();
    expect(setActiveLeaf).toHaveBeenCalledOnce();
  });

  it("opens and reveals a current occurrence, but omits a stale range", async () => {
    const current = await render({});
    await act(() =>
      (
        current.container.querySelector("[data-occurrence]") as HTMLElement
      ).click(),
    );
    await act(async () => Promise.resolve());
    expect(current.openLinkText).toHaveBeenLastCalledWith(
      group.path,
      "",
      false,
    );
    expect(current.setEphemeralState).toHaveBeenLastCalledWith({
      startLoc: group.occurrences[0]!.position.start,
      endLoc: group.occurrences[0]!.position.end,
      line: 0,
    });

    await act(() => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
    const stale = await render({ read: () => Promise.resolve("changed") });
    await act(() =>
      (
        stale.container.querySelector("[data-occurrence]") as HTMLElement
      ).click(),
    );
    expect(stale.openLinkText).toHaveBeenLastCalledWith(group.path, "", false);
    expect(stale.setEphemeralState).not.toHaveBeenCalled();
  });

  it("omits a stale wikilink range when the metadata cache lags the source", async () => {
    const original = "See [[Doe 2024]].";
    const offset = original.indexOf("[[");
    const position = {
      start: { line: 0, col: offset, offset },
      end: { line: 0, col: offset + 12, offset: offset + 12 },
    };
    const wikilinkGroup: CitedByGroup = {
      path: group.path,
      occurrences: [{ kind: "wikilink", raw: "Doe 2024", position }],
    };
    const { container, openLinkText, setEphemeralState } = await render({
      snapshot: snapshot({ groups: [wikilinkGroup] }),
      read: () => Promise.resolve("See [[Roe 2025]]."),
      links: [{ link: "Doe 2024", original: "[[Doe 2024]]", position }],
    });

    await act(() =>
      (container.querySelector("[data-occurrence]") as HTMLElement).click(),
    );

    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toContain("Preview unavailable");
    expect(openLinkText).toHaveBeenLastCalledWith(group.path, "", false);
    expect(setEphemeralState).not.toHaveBeenCalled();
  });

  it("emphasizes and reveals the exact current wikilink", async () => {
    const source = "See [[Doe 2024]].";
    const offset = source.indexOf("[[");
    const position = {
      start: { line: 0, col: offset, offset },
      end: { line: 0, col: offset + 12, offset: offset + 12 },
    };
    const wikilinkGroup: CitedByGroup = {
      path: group.path,
      occurrences: [{ kind: "wikilink", raw: "Doe 2024", position }],
    };
    const { container, openLinkText, setEphemeralState } = await render({
      snapshot: snapshot({ groups: [wikilinkGroup] }),
      read: () => Promise.resolve(source),
      links: [{ link: "Doe 2024", original: "[[Doe 2024]]", position }],
    });

    expect(container.querySelector("mark")?.textContent).toBe("[[Doe 2024]]");
    await act(() =>
      (container.querySelector("[data-occurrence]") as HTMLElement).click(),
    );
    await act(async () => Promise.resolve());
    expect(openLinkText).toHaveBeenLastCalledWith(group.path, "", false);
    expect(setEphemeralState).toHaveBeenLastCalledWith({
      startLoc: position.start,
      endLoc: position.end,
      line: 0,
    });
  });

  it("collapses and expands every source group from one toolbar toggle", async () => {
    const { container } = await render({
      snapshot: snapshot({
        groups: [
          { ...group, path: "Folder A/draft.md" },
          { ...group, path: "Folder B/draft.md" },
        ],
      }),
    });
    await act(async () => Promise.resolve());
    const toggle = container.querySelector(
      "[data-cited-by-collapse-results]",
    ) as HTMLElement;
    const expanded = () =>
      [...container.querySelectorAll("[data-cited-by-source-toggle]")].map(
        (source) => source.getAttribute("aria-expanded"),
      );
    expect(expanded()).toEqual(["true", "true"]);
    expect(toggle.classList).not.toContain("is-active");
    expect(
      container.querySelector("[data-cited-by-collapse-results] svg")
        ?.classList,
    ).toContain("lucide-list");

    await act(() => toggle.click());
    expect(expanded()).toEqual(["false", "false"]);
    expect(toggle.classList).toContain("is-active");

    await act(() => toggle.click());
    await act(async () => Promise.resolve());
    expect(expanded()).toEqual(["true", "true"]);
    expect(toggle.classList).not.toContain("is-active");
  });

  it("drops the counts row and the expand all / collapse all pair", async () => {
    const { container } = await render({});
    expect(container.textContent).not.toContain("Expand all");
    expect(container.textContent).not.toContain("Collapse all");
    expect(
      container.querySelectorAll("[data-cited-by-collapse-results]"),
    ).toHaveLength(1);
  });

  it("activates the toolbar toggle from the keyboard", async () => {
    const { container, store } = await render({});
    await act(async () => Promise.resolve());
    const toggle = container.querySelector(
      "[data-cited-by-collapse-results]",
    ) as HTMLElement;

    await act(() => {
      toggle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(store.getState().collapsed).toEqual([group.path]);
  });

  it("shows note and occurrence counts, folders for duplicate names, and the self label", async () => {
    const duplicateGroups: CitedByGroup[] = [
      { ...group, path: "Folder A/draft.md" },
      { ...group, path: "Folder B/draft.md" },
    ];
    const { container } = await render({
      activePath: "Folder A/draft.md",
      snapshot: snapshot({ groups: duplicateGroups }),
    });

    expect(container.textContent).toContain("2 notes");
    expect(container.textContent).toContain("2 citations");
    expect(container.textContent).toContain("This note");
    expect(container.textContent).toContain("draft — Folder B");
  });

  it("filters by note path and by loaded context, collapsed groups included", async () => {
    const { container, store } = await render({ collapsed: true });
    await act(async () => Promise.resolve());

    await act(() => store.setState({ search: "notes/draft" }));
    expect(container.querySelector("[data-source]")).not.toBeNull();

    await act(() => store.setState({ search: "reason cites" }));
    expect(container.querySelector("[data-source]")).not.toBeNull();

    await act(() => store.setState({ search: "not present" }));
    expect(container.querySelector("[data-source]")).toBeNull();
  });

  it("switches every excerpt between its line and its enclosing block", async () => {
    const { container } = await render({
      snapshot: snapshot({ groups: [citedIn(paragraphBody)] }),
      read: () => Promise.resolve(paragraphBody),
      sections: paragraphSections,
    });
    await act(async () => Promise.resolve());
    const card = () => container.querySelector("[data-occurrence]");
    const toggle = container.querySelector(
      "[data-cited-by-show-more-context]",
    ) as HTMLElement;
    expect(card()?.textContent).toBe("A reason cites @doe2024 here.");

    await act(() => toggle.click());
    expect(card()?.textContent).toBe(
      "A reason cites @doe2024 here.\nSecond line of the block.",
    );
    expect(card()?.querySelector("mark")?.textContent).toBe("@doe2024");

    await act(() => toggle.click());
    expect(card()?.textContent).toBe("A reason cites @doe2024 here.");
  });

  it("expands an occurrence inside a list to its item and descendants", async () => {
    const { container } = await render({
      snapshot: snapshot({ groups: [citedIn(listBody)] }),
      read: () => Promise.resolve(listBody),
      sections: listSections,
      listItems,
    });
    await act(async () => Promise.resolve());
    const card = () => container.querySelector("[data-occurrence]");
    expect(card()?.textContent).toBe("- Alpha cites @doe2024 here.");

    await act(() =>
      (
        container.querySelector(
          "[data-cited-by-show-more-context]",
        ) as HTMLElement
      ).click(),
    );

    expect(card()?.textContent).toBe(
      "- Alpha cites @doe2024 here.\n  - Nested detail.",
    );
  });

  it("keeps an occurrence inside a heading on its own line", async () => {
    const { container } = await render({
      snapshot: snapshot({ groups: [citedIn(headingBody)] }),
      read: () => Promise.resolve(headingBody),
      sections: headingSections,
    });
    await act(async () => Promise.resolve());
    const card = () => container.querySelector("[data-occurrence]");
    expect(card()?.textContent).toBe("# Heading cites @doe2024 here");

    await act(() =>
      (
        container.querySelector(
          "[data-cited-by-show-more-context]",
        ) as HTMLElement
      ).click(),
    );

    expect(card()?.textContent).toBe("# Heading cites @doe2024 here");
  });

  it("caps the compact excerpt and reveals the full paragraph on toggle", async () => {
    const { container } = await render({
      snapshot: snapshot({ groups: [citedIn(longLineBody)] }),
      read: () => Promise.resolve(longLineBody),
      sections: longLineSections,
    });
    await act(async () => Promise.resolve());
    const card = () => container.querySelector("[data-occurrence]");
    const compactText = `…${"x ".repeat(COMPACT_CAP / 2)}@doe2024${" y".repeat(COMPACT_CAP / 2)}…`;

    // Compact mode: only COMPACT_CAP characters on each side of the match.
    expect(card()?.textContent).toBe(compactText);

    // Toggle reveals the full single-line paragraph.
    await act(() =>
      (
        container.querySelector(
          "[data-cited-by-show-more-context]",
        ) as HTMLElement
      ).click(),
    );
    expect(card()?.textContent).toBe(longParagraph);

    // Toggle back returns to the capped compact excerpt.
    await act(() =>
      (
        container.querySelector(
          "[data-cited-by-show-more-context]",
        ) as HTMLElement
      ).click(),
    );
    expect(card()?.textContent).toBe(compactText);
  });

  it("offers no chevron on a card that already shows the whole note", async () => {
    const { container } = await render({});
    await act(async () => Promise.resolve());

    expect(container.querySelector("[data-occurrence]")?.textContent).toBe(
      "A reason cites @doe2024 here.",
    );
    expect(container.querySelector("[data-cited-by-expand]")).toBeNull();
  });

  it("reveals one logical chunk per chevron activation, on either side", async () => {
    const { container } = await render({
      snapshot: snapshot({ groups: [citedIn(expansionBody)] }),
      read: () => Promise.resolve(expansionBody),
      sections: expansionSections,
      listItems: expansionListItems,
    });
    await act(async () => Promise.resolve());
    const card = () => container.querySelector("[data-occurrence]");
    expect(card()?.textContent).toBe("- Alpha cites @doe2024 here.");
    const chevron = container.querySelector(
      '[data-cited-by-expand="after"]',
    ) as HTMLElement;
    expect(chevron.classList).toContain("zt:opacity-0");
    expect(chevron.classList).toContain("zt:group-hover:opacity-100");
    expect(chevron.classList).toContain("zt:group-focus-within:opacity-100");

    await expandContext(container, "after");
    expect(card()?.textContent).toBe(
      "- Alpha cites @doe2024 here.\n  - Nested detail.",
    );

    await expandContext(container, "after");
    expect(card()?.textContent).toBe(
      "- Alpha cites @doe2024 here.\n  - Nested detail.\n- Beta item.",
    );

    await expandContext(container, "after");
    expect(card()?.textContent).toBe(
      "- Alpha cites @doe2024 here.\n  - Nested detail.\n- Beta item.\n\nClosing paragraph.",
    );
    expect(
      container.querySelector('[data-cited-by-expand="after"]'),
    ).toBeNull();

    await expandContext(container, "before");
    expect(card()?.textContent).toBe(
      "Intro paragraph.\n\n- Alpha cites @doe2024 here.\n  - Nested detail.\n- Beta item.\n\nClosing paragraph.",
    );

    await expandContext(container, "before");
    expect(card()?.textContent).toBe(expansionBody.trimEnd());
    expect(container.querySelector("[data-cited-by-expand]")).toBeNull();
  });

  it("reveals the adjacent line where the cache resolves no chunk", async () => {
    const { container } = await render({
      snapshot: snapshot({ groups: [citedIn(multiBody)] }),
      read: () => Promise.resolve(multiBody),
    });
    await act(async () => Promise.resolve());
    const card = () => container.querySelector("[data-occurrence]");
    expect(card()?.textContent).toBe("Alpha cites @doe2024 here.");
    expect(
      container.querySelector('[data-cited-by-expand="before"]'),
    ).toBeNull();

    await expandContext(container, "after");

    expect(card()?.textContent).toBe(multiBody.trimEnd());
    expect(container.querySelector("[data-cited-by-expand]")).toBeNull();
  });

  it("expands from the keyboard and leaves the citing note closed", async () => {
    const { container, openLinkText } = await render({
      snapshot: snapshot({ groups: [citedIn(multiBody)] }),
      read: () => Promise.resolve(multiBody),
    });
    await act(async () => Promise.resolve());
    const chevron = container.querySelector(
      '[data-cited-by-expand="after"]',
    ) as HTMLElement;

    await act(() => {
      chevron.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(container.querySelector("[data-occurrence]")?.textContent).toBe(
      multiBody.trimEnd(),
    );
    expect(openLinkText).not.toHaveBeenCalled();
  });

  it("marks the context mode active and toggles it from the keyboard", async () => {
    const { container, store } = await render({});
    await act(async () => Promise.resolve());
    const toggle = container.querySelector(
      "[data-cited-by-show-more-context]",
    ) as HTMLElement;
    expect(toggle.classList).not.toContain("is-active");
    expect(
      container.querySelector("[data-cited-by-show-more-context] svg")
        ?.classList,
    ).toContain("lucide-move-vertical");

    await act(() => {
      toggle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(store.getState().moreContext).toBe(true);
    expect(
      container.querySelector("[data-cited-by-show-more-context]")?.classList,
    ).toContain("is-active");
  });

  it("keeps the search field out of view until the toolbar action opens it", async () => {
    const { container } = await render({});
    expect(container.querySelector("[data-cited-by-search]")).toBeNull();
    const action = container.querySelector(
      "[data-cited-by-show-search]",
    ) as HTMLElement;
    expect(action.classList).not.toContain("is-active");
    expect(
      container.querySelector("[data-cited-by-show-search] svg")?.classList,
    ).toContain("lucide-search");

    await act(() => {
      action.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    const input = container.querySelector(
      "[data-cited-by-search] input",
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(
      container.querySelector("[data-cited-by-show-search]")?.classList,
    ).toContain("is-active");
  });

  it("clears the query and restores every result when the search closes", async () => {
    const { container, store } = await render({ searchVisible: true });
    await act(async () => Promise.resolve());
    await act(() => store.setState({ search: "not present" }));
    expect(container.querySelector("[data-cited-by-result]")).toBeNull();

    await act(() =>
      (
        container.querySelector("[data-cited-by-show-search]") as HTMLElement
      ).click(),
    );

    expect(store.getState().search).toBe("");
    expect(container.querySelector("[data-cited-by-search]")).toBeNull();
    expect(container.querySelector("[data-cited-by-result]")).not.toBeNull();
  });

  it("keeps every occurrence of a group whose note name matches", async () => {
    const { container, store } = await render({
      snapshot: snapshot({ groups: [multiGroup] }),
      read: () => Promise.resolve(multiBody),
    });
    await act(async () => Promise.resolve());

    await act(() => store.setState({ search: "draft" }));

    expect(container.querySelectorAll("[data-occurrence]")).toHaveLength(2);
  });

  it("keeps only matching occurrences, collapsed groups included", async () => {
    const { actions, container, read, store } = await render({
      collapsed: true,
      snapshot: snapshot({ groups: [multiGroup] }),
      read: () => Promise.resolve(multiBody),
    });
    await act(async () => Promise.resolve());
    expect(read).toHaveBeenCalledOnce();

    await act(() => store.setState({ search: "beta cites" }));
    expect(container.querySelector("[data-cited-by-result]")).not.toBeNull();
    expect(read).toHaveBeenCalledOnce();

    await act(() => actions.expandAll());
    const cards = container.querySelectorAll("[data-occurrence]");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.textContent).toBe("Beta cites @doe2024 there.");
    expect(read).toHaveBeenCalledOnce();
  });

  it("applies a typed query only after the input debounce elapses", async () => {
    const { container, store } = await render({ searchVisible: true });
    await act(async () => Promise.resolve());
    vi.useFakeTimers();
    const input = container.querySelector(
      "[data-cited-by-search] input",
    ) as HTMLInputElement;

    await act(() => {
      input.value = "not present";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.value).toBe("not present");
    expect(store.getState().search).toBe("");
    expect(container.querySelector("[data-cited-by-result]")).not.toBeNull();

    await act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(store.getState().search).toBe("not present");
    expect(container.querySelector("[data-cited-by-result]")).toBeNull();
  });

  it("expands and collapses all visible source groups", async () => {
    const { actions, container } = await render({});
    await act(async () => Promise.resolve());
    expect(container.querySelector("[data-occurrence]")).not.toBeNull();

    await act(() => actions.collapseAll());
    expect(container.querySelector("[data-occurrence]")).toBeNull();
    expect(container.querySelector("[aria-expanded=false]")).not.toBeNull();

    await act(() => actions.expandAll());
    await act(async () => Promise.resolve());
    expect(container.querySelector("[data-occurrence]")).not.toBeNull();
  });

  it("preserves search and expands groups when the target changes", async () => {
    const { actions, container, read, store } = await render({
      search: "draft",
    });
    await act(async () => Promise.resolve());
    await act(() => actions.collapseAll());
    const nextGroup: CitedByGroup = {
      ...group,
      occurrences: [{ ...group.occurrences[0]!, raw: "other" }],
    };

    await act(() =>
      store.setState({
        indexedKey: "NEXT0001",
        activePath: "Other.md",
        snapshot: snapshot({ groups: [nextGroup] }),
        collapsed: [],
      }),
    );
    await act(async () => Promise.resolve());

    expect(store.getState().search).toBe("draft");
    expect(container.querySelector("[aria-expanded=true]")).not.toBeNull();
    expect(
      container.querySelector('[data-occurrence$=":other"]'),
    ).not.toBeNull();
    expect(read).toHaveBeenCalledOnce();
    expect(createCitedByStore().getState()).toMatchObject({
      search: "",
      collapsed: [],
    });
  });

  it("offers the six Backlinks sort modes and marks the one in force", async () => {
    const { container } = await render({});
    const action = container.querySelector("[data-cited-by-sort]");
    expect(action?.getAttribute("aria-label")).toBe("Change sort order");
    expect(action?.querySelector("svg")?.classList).toContain(
      "lucide-sort-asc",
    );

    const menu = await openSortMenu(container);
    expect(menu.items.map((item) => item.title)).toEqual([
      "File name (A to Z)",
      "File name (Z to A)",
      "Modified time (new to old)",
      "Modified time (old to new)",
      "Created time (new to old)",
      "Created time (old to new)",
    ]);
    expect(menu.items.map((item) => item.checked)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);

    await chooseSort(container, "Created time (old to new)");
    const reopened = await openSortMenu(container);
    expect(reopened.items.map((item) => item.checked)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it("orders source groups by every mode, breaking ties by vault path", async () => {
    const { container } = await render({
      snapshot: snapshot({ groups: sortedGroups }),
      stats: sortedStats,
    });
    expect(sourceLabels(container)).toEqual(["alpha — B", "alpha — C", "beta"]);

    await chooseSort(container, "File name (Z to A)");
    expect(sourceLabels(container)).toEqual(["beta", "alpha — B", "alpha — C"]);

    await chooseSort(container, "Modified time (new to old)");
    expect(sourceLabels(container)).toEqual(["alpha — B", "beta", "alpha — C"]);

    await chooseSort(container, "Modified time (old to new)");
    expect(sourceLabels(container)).toEqual(["alpha — C", "beta", "alpha — B"]);

    await chooseSort(container, "Created time (new to old)");
    expect(sourceLabels(container)).toEqual(["beta", "alpha — C", "alpha — B"]);

    await chooseSort(container, "Created time (old to new)");
    expect(sourceLabels(container)).toEqual(["alpha — B", "alpha — C", "beta"]);
  });

  it("breaks equal-time ties by vault path in every time mode", async () => {
    const tied = { ctime: 7, mtime: 7 };
    const { container } = await render({
      snapshot: snapshot({ groups: sortedGroups }),
      stats: {
        "A/beta.md": tied,
        "B/alpha.md": tied,
        "C/alpha.md": tied,
      },
    });
    for (const mode of [
      "Modified time (new to old)",
      "Modified time (old to new)",
      "Created time (new to old)",
      "Created time (old to new)",
    ]) {
      await chooseSort(container, mode);
      expect(sourceLabels(container)).toEqual([
        "beta",
        "alpha — B",
        "alpha — C",
      ]);
    }
  });

  it("sorts a group whose file left the vault by its name at time zero", async () => {
    const { container } = await render({
      snapshot: snapshot({ groups: sortedGroups }),
      stats: sortedStats,
      missingPaths: ["B/alpha.md"],
    });
    expect(sourceLabels(container)).toEqual(["alpha — B", "alpha — C", "beta"]);

    await chooseSort(container, "Modified time (new to old)");
    expect(sourceLabels(container)).toEqual(["beta", "alpha — C", "alpha — B"]);

    await chooseSort(container, "Created time (new to old)");
    expect(sourceLabels(container)).toEqual(["beta", "alpha — C", "alpha — B"]);
  });

  it("keeps every group's occurrences in source order in every mode", async () => {
    const { container } = await render({
      snapshot: snapshot({
        groups: [
          { ...multiGroup, path: "A/first.md" },
          { ...multiGroup, path: "B/second.md" },
        ],
      }),
      read: () => Promise.resolve(multiBody),
      stats: {
        "A/first.md": { ctime: 1, mtime: 2 },
        "B/second.md": { ctime: 2, mtime: 1 },
      },
    });
    await act(async () => Promise.resolve());
    const excerpts = () =>
      [...container.querySelectorAll("[data-occurrence]")].map(
        (card) => card.textContent,
      );
    const inSourceOrder = [
      "Alpha cites @doe2024 here.",
      "Beta cites @doe2024 there.",
      "Alpha cites @doe2024 here.",
      "Beta cites @doe2024 there.",
    ];
    expect(excerpts()).toEqual(inSourceOrder);

    for (const mode of [
      "File name (Z to A)",
      "Modified time (new to old)",
      "Modified time (old to new)",
      "Created time (new to old)",
      "Created time (old to new)",
    ]) {
      await chooseSort(container, mode);
      expect(excerpts()).toEqual(inSourceOrder);
    }
  });

  it("does not match context cached for the previous target", async () => {
    const { container, store } = await render({});
    await act(async () => Promise.resolve());
    await act(() => store.setState({ search: "reason cites" }));
    expect(container.querySelector("[data-source]")).not.toBeNull();
    const nextGroup: CitedByGroup = {
      ...group,
      occurrences: [{ ...group.occurrences[0]!, raw: "other" }],
    };

    await act(() =>
      store.setState({
        indexedKey: "ZZZ99999g7",
        snapshot: snapshot({ groups: [nextGroup] }),
        collapsed: [],
      }),
    );

    expect(container.querySelector("[data-source]")).toBeNull();
  });
});
