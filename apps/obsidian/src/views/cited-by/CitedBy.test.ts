// @vitest-environment happy-dom
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
import { createCitedByStore, CitedByStoreProvider } from "./store";

vi.mock("zustand", async () => {
  const { useSyncExternalStore } = await import("preact/compat");
  return {
    useStore: <T, U>(
      store: {
        subscribe: (listener: () => void) => () => void;
        getState: () => T;
      },
      selector: (state: T) => U,
    ) =>
      useSyncExternalStore(store.subscribe, () => selector(store.getState())),
  };
});

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
    resolution: "ready",
    ...overrides,
  };
}

function makeFile(path: string = group.path): TFile {
  const file = new TFile();
  const name = path.slice(path.lastIndexOf("/") + 1);
  file.path = path;
  file.name = name;
  file.basename = name.slice(0, -".md".length);
  file.extension = "md";
  file.stat = { ctime: 0, mtime: 1, size: body.length };
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
}) {
  const shown = options.snapshot ?? snapshot();
  const files = new Map(
    shown.groups.map(({ path }) => [path, makeFile(path)] as const),
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

describe("CitedBy", () => {
  it("asks for a literature note outside the Literature Note context", async () => {
    const { container } = await render({ indexedKey: null });
    expect(container.textContent).toBe(
      "Open a literature note to see citations.",
    );
    expect(container.querySelector("[data-cited-by-empty]")).not.toBeNull();
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
        resolution: "degraded",
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
        resolution: "degraded",
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
        resolution: "resolving",
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

    expect(container.textContent).toBe("No notes cite this literature note.");
    expect(container.querySelector("[data-cited-by-empty]")).not.toBeNull();
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
    expect(container.textContent).toBe("No notes cite this literature note.");
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
    expect(
      container.querySelector("[data-cited-by-collapse-results]")?.classList,
    ).toContain("nav-action-button");
    expect(
      container.querySelector("[data-cited-by-section-count]")?.textContent,
    ).toBe("1 note · 1 citation");
  });

  it("collapses the result section from its header, apart from the toolbar toggle", async () => {
    const { container } = await render({});
    await act(async () => Promise.resolve());
    const header = container.querySelector(
      "[data-cited-by-section-header]",
    ) as HTMLElement;
    expect(header.textContent).toContain("Cited by");
    expect(header.getAttribute("aria-expanded")).toBe("true");

    await act(() => header.click());
    expect(container.querySelector("[data-cited-by-results]")).toBeNull();
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(
      container.querySelector("[data-cited-by-collapse-results]")?.classList,
    ).not.toContain("is-active");
    expect(
      container.querySelector("[data-cited-by-section-chevron] svg")?.classList,
    ).toContain("lucide-chevron-right");

    await act(() => header.click());
    await act(async () => Promise.resolve());
    expect(container.querySelector("[data-cited-by-results]")).not.toBeNull();
    expect(container.querySelector("[data-occurrence]")).not.toBeNull();
  });

  it("activates the toolbar toggle and the section header from the keyboard", async () => {
    const { container, store } = await render({});
    await act(async () => Promise.resolve());
    const toggle = container.querySelector(
      "[data-cited-by-collapse-results]",
    ) as HTMLElement;
    const header = container.querySelector(
      "[data-cited-by-section-header]",
    ) as HTMLElement;

    await act(() => {
      toggle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(store.getState().collapsed).toEqual([group.path]);

    await act(() => {
      header.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true }),
      );
    });
    expect(store.getState().sectionCollapsed).toBe(true);
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
    expect(card()?.textContent).toBe("…A reason cites @doe2024 here.…");

    await act(() => toggle.click());
    expect(card()?.textContent).toBe(
      "…A reason cites @doe2024 here.\nSecond line of the block.",
    );
    expect(card()?.querySelector("mark")?.textContent).toBe("@doe2024");

    await act(() => toggle.click());
    expect(card()?.textContent).toBe("…A reason cites @doe2024 here.…");
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
    expect(card()?.textContent).toBe("- Alpha cites @doe2024 here.…");

    await act(() =>
      (
        container.querySelector(
          "[data-cited-by-show-more-context]",
        ) as HTMLElement
      ).click(),
    );

    expect(card()?.textContent).toBe(
      "- Alpha cites @doe2024 here.\n  - Nested detail.…",
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
    expect(card()?.textContent).toBe("# Heading cites @doe2024 here…");

    await act(() =>
      (
        container.querySelector(
          "[data-cited-by-show-more-context]",
        ) as HTMLElement
      ).click(),
    );

    expect(card()?.textContent).toBe("# Heading cites @doe2024 here…");
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
    expect(
      container.querySelector("[data-cited-by-section-count]")?.textContent,
    ).toBe("1 note · 2 citations");
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
    expect(
      container.querySelector("[data-cited-by-section-count]")?.textContent,
    ).toBe("1 note · 1 citation");
    expect(read).toHaveBeenCalledOnce();

    await act(() => actions.expandAll());
    const cards = container.querySelectorAll("[data-occurrence]");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.textContent).toBe("…Beta cites @doe2024 there.");
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
    expect(
      container.querySelector("[data-cited-by-section-count]")?.textContent,
    ).toBe("0 notes · 0 citations");
  });

  it("expands and collapses all visible source groups", async () => {
    const { actions, container } = await render({});
    await act(async () => Promise.resolve());
    expect(container.querySelector("[data-occurrence]")).not.toBeNull();

    await act(() => actions.collapseAll());
    expect(container.querySelector("[data-occurrence]")).toBeNull();
    expect(container.querySelector("[aria-expanded=false]")).not.toBeNull();
    expect(
      container.querySelector("[data-cited-by-source-header] svg")?.classList,
    ).toContain("lucide-chevron-right");

    await act(() => actions.expandAll());
    await act(async () => Promise.resolve());
    expect(container.querySelector("[data-occurrence]")).not.toBeNull();
    expect(
      container.querySelector("[data-cited-by-source-header] svg")?.classList,
    ).toContain("lucide-chevron-down");
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
