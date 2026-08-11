// @vitest-environment happy-dom
import { Keymap, MarkdownView, TFile } from "obsidian";
import type { App, CachedMetadata, LinkCache, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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

let root: Root | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
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

function makeFile(): TFile {
  const file = new TFile();
  file.path = group.path;
  file.name = "draft.md";
  file.basename = "draft";
  file.extension = "md";
  file.stat = { ctime: 0, mtime: 1, size: body.length };
  return file;
}

async function render(options: {
  indexedKey?: string | null;
  snapshot?: CitedBySnapshot;
  read?: () => Promise<string>;
  collapsed?: boolean;
  activePath?: string | null;
  search?: string;
  links?: LinkCache[];
  duplicateSourceLeaf?: boolean;
}) {
  const file = makeFile();
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
      getAbstractFileByPath: (path: string) =>
        path === file.path ? file : null,
      cachedRead: read,
    },
    metadataCache: {
      getFileCache: () => ({ links: options.links ?? [] }) as CachedMetadata,
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
    snapshot: options.snapshot ?? snapshot(),
    collapsed: options.collapsed ? [group.path] : [],
    activePath: options.activePath ?? null,
    search: options.search ?? "",
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

  it("reads expanded context lazily, emphasizes the token, and reuses the mtime cache", async () => {
    const { actions, container, read } = await render({ collapsed: true });
    expect(read).not.toHaveBeenCalled();

    await act(async () => {
      actions.expandAll();
      await Promise.resolve();
    });
    await act(async () => Promise.resolve());
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

  it("invalidates cached context when the note modification time changes", async () => {
    const { actions, file, read } = await render({});
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

  it("filters by note path and loaded visible context", async () => {
    const { container, store } = await render({});
    await act(async () => Promise.resolve());

    await act(() => store.setState({ search: "notes/draft" }));
    expect(container.querySelector("[data-source]")).not.toBeNull();

    await act(() => store.setState({ search: "reason cites" }));
    expect(container.querySelector("[data-source]")).not.toBeNull();

    await act(() => store.setState({ search: "not present" }));
    expect(container.querySelector("[data-source]")).toBeNull();
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
